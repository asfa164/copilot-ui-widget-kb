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

    // --- 2️⃣ Slack verification (first handshake) ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3️⃣ Ack Slack immediately (<3s) ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4️⃣ Extract Slack message event ---
    const event = payload.event;
    if (!event) return console.log("⚠️ No event object found");
    if (event.bot_id || event.subtype === "bot_message") return console.log("🤖 Ignored bot message");

    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- 5️⃣ Check environment variables ---
    const CYARA_API_URL =
      process.env.CYARA_API_URL ||
      "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";
    const CYARA_AUTH_TOKEN = process.env.CYARA_AUTH_TOKEN;
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

    console.log("🔍 ENV CHECK", {
      CYARA_API_URL,
      CYARA_AUTH_TOKEN: CYARA_AUTH_TOKEN ? "✅ exists" : "❌ missing",
      SLACK_BOT_TOKEN: SLACK_BOT_TOKEN ? "✅ exists" : "❌ missing",
    });

    if (!CYARA_AUTH_TOKEN || !SLACK_BOT_TOKEN) {
      console.error("❌ Missing environment variables");
      return;
    }

    // --- 6️⃣ Build payload (same as Python version) ---
    const cyaraPayload = {
      message: text,
      sessionAttributes: {
        product: "voice_assure",
        request_source: "ui",
        auth_token: CYARA_AUTH_TOKEN,
      },
    };

    console.log("📦 Payload:", JSON.stringify(cyaraPayload));

    // --- 7️⃣ Send request to Cyara external API ---
    const startTime = Date.now();
    let cyaraResp;
    try {
      cyaraResp = await fetch(CYARA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cyaraPayload),
      });
    } catch (err) {
      console.error("🔥 Network/Fetch error:", err.message);
      await postFallback(SLACK_BOT_TOKEN, event.channel, event.ts);
      return;
    }

    const endTime = Date.now();
    const elapsedTime = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`⏱️ Elapsed time: ${elapsedTime}s`);

    console.log("🛰️ CYARA API HTTP status:", cyaraResp.status);

    // --- 8️⃣ Read raw text + attempt JSON parse ---
    const rawText = await cyaraResp.text();
    console.log("📩 CYARA raw response:", rawText);

    let data = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      console.error("❌ Response not valid JSON, using raw text");
      data = { message: rawText };
    }

    // --- 9️⃣ Determine reply text for Slack ---
    const reply =
      data.reply ||
      data.message ||
      data.response ||
      "⚠️ Cyara API did not return a valid reply.";

    console.log("💬 Reply to Slack:", reply);

    // --- 🔟 Post reply back to Slack ---
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

// --- Helper for fallback Slack message ---
async function postFallback(botToken, channel, threadTs) {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel,
        text: "⚠️ Sorry, I couldn’t reach Cyara API right now. Please try again shortly.",
        thread_ts: threadTs,
      }),
    });
  } catch (err) {
    console.error("❌ Fallback message failed:", err);
  }
}
