// Disable body parsing for Slack event verification
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  console.log("⚡ Incoming Slack request");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // --- 1️⃣ Read raw body (Slack requirement) ---
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error("❌ JSON parse error:", err);
    }

    // --- 2️⃣ Slack verification handshake ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3️⃣ Acknowledge Slack (must be <3s) ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4️⃣ Extract message ---
    const event = payload.event;
    if (!event) return console.log("⚠️ No event object found");
    if (event.bot_id || event.subtype === "bot_message") return console.log("🤖 Ignored bot message");

    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- 5️⃣ Environment variables ---
    const CYARA_API_URL =
      process.env.CYARA_API_URL ||
      "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";
    const API_TOKEN = process.env.API_TOKEN;
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

    console.log("🔍 ENV CHECK", {
      CYARA_API_URL,
      API_TOKEN: API_TOKEN ? "✅ exists" : "❌ missing",
      SLACK_BOT_TOKEN: SLACK_BOT_TOKEN ? "✅ exists" : "❌ missing",
    });

    if (!API_TOKEN || !SLACK_BOT_TOKEN) {
      console.error("❌ Missing required env vars");
      return;
    }

    // --- 6️⃣ Compose payload (as chat.js does) ---
    const query = text;
    const token = API_TOKEN;

    const upstreamPayload = {
      query,
      sessionAttributes: {
        auth_token: token,
        product: "voice_assure",
        request_source: "ui",
      },
    };

    console.log("📦 Upstream payload:", JSON.stringify(upstreamPayload));

    // --- 7️⃣ Send to Cyara API ---
    const controller = new AbortController();
    const timeoutMs = 25000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let upstreamRes;
    try {
      upstreamRes = await fetch(CYARA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upstreamPayload),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      console.error("🔥 Fetch failed:", err.name, err.message);
      await postFallback(SLACK_BOT_TOKEN, event.channel, event.ts, "⚠️ Could not reach Cyara API.");
      return;
    }

    const elapsed = `${((timeoutMs - controller.signal.reason) / 1000) || "?"} s`;
    console.log("🛰️ CYARA HTTP status:", upstreamRes.status);

    const rawText = await upstreamRes.text();
    console.log("📩 CYARA raw response:", rawText);

    let data = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("❌ Response not JSON, using raw text");
      data = { message: rawText };
    }

    const reply =
      data.message ||
      data.reply ||
      data.response ||
      "⚠️ Cyara API did not return a valid message.";

    console.log("💬 Reply to Slack:", reply);

    // --- 8️⃣ Reply back in Slack ---
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: event.channel,
        text: reply,
        thread_ts: event.ts,
      }),
    });

    const slackResult = await slackResp.json();
    console.log("📡 Slack API result:", slackResult);
  } catch (err) {
    console.error("🔥 Slack handler exception:", err);
  }
}

// --- Helper: fallback message in Slack ---
async function postFallback(botToken, channel, threadTs, msg) {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel,
        text: msg || "⚠️ Cyara API did not respond. Please try again later.",
        thread_ts: threadTs,
      }),
    });
  } catch (err) {
    console.error("❌ Fallback message failed:", err);
  }
}
