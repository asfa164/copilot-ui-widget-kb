// ✅ Force Node.js runtime for full fetch + console support
export const runtime = "nodejs";

// ✅ Disable body parsing so Slack verification works
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

    // --- 2️⃣ Handle Slack verification challenge ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3️⃣ Acknowledge Slack immediately (<3s) ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4️⃣ Run async background task after ack ---
    (async () => {
      try {
        const event = payload.event;
        if (!event) return console.log("⚠️ No event object found");
        if (event.bot_id || event.subtype === "bot_message")
          return console.log("🤖 Ignored bot message");

        const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
        console.log("💬 User text:", text);

        // --- 5️⃣ Load environment variables ---
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
          console.error("❌ Missing environment variables");
          return;
        }

        // --- 6️⃣ Build payload (same as /api/chat.js) ---
        const upstreamPayload = {
          query: text,
          sessionAttributes: {
            auth_token: API_TOKEN,
            product: "voice_assure",
            request_source: "ui",
          },
        };

        console.log("📦 Upstream payload:", JSON.stringify(upstreamPayload));

        // --- 7️⃣ Call Cyara API with timeout (25s) ---
        const controller = new AbortController();
        const timeoutMs = 25000;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        const start = Date.now();

        let upstreamRes, rawResponse;
        try {
          console.log("🧭 Sending to:", CYARA_API_URL);

          upstreamRes = await fetch(CYARA_API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(upstreamPayload),
            signal: controller.signal,
          });

          clearTimeout(timer);

          const elapsed = Date.now() - start;
          console.log(`⏱️ CYARA responded in ${elapsed} ms, status: ${upstreamRes.status}`);

          rawResponse = await upstreamRes.text();
          console.log("📩 CYARA raw response:", rawResponse);
        } catch (err) {
          const elapsed = Date.now() - start;
          console.error(`🔥 Fetch failed after ${elapsed} ms:`, err.name, err.message);
          if (err.name === "AbortError") {
            await postFallback(
              SLACK_BOT_TOKEN,
              event.channel,
              event.ts,
              "⏰ Cyara API took too long (25s timeout)."
            );
          } else {
            await postFallback(
              SLACK_BOT_TOKEN,
              event.channel,
              event.ts,
              "⚠️ Could not reach Cyara API."
            );
          }
          return;
        }

        // --- 8️⃣ Parse Cyara response ---
        let data;
        try {
          data = JSON.parse(rawResponse);
        } catch {
          data = { message: rawResponse };
        }

        const reply =
          data.message ||
          data.reply ||
          data.response ||
          "⚠️ Cyara API returned no valid message.";

        console.log("💬 Reply to Slack:", reply);

        // --- 9️⃣ Send reply to Slack ---
        await sendSlackMessage(SLACK_BOT_TOKEN, event.channel, reply, event.ts);
      } catch (err) {
        console.error("🔥 Slack background error:", err);
      }
    })();
  } catch (err) {
    console.error("🔥 Slack handler exception:", err);
  }
}

// --- Helper: send Slack message ---
async function sendSlackMessage(token, channel, text, thread_ts) {
  try {
    const resp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, text, thread_ts }),
    });
    const data = await resp.json();
    console.log("📡 Slack post result:", data);
  } catch (e) {
    console.error("❌ Slack post failed:", e);
  }
}

// --- Helper: fallback message when API fails ---
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
