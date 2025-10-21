export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  console.log("⚡ Incoming Slack request");

  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    // --- 1️⃣ Parse raw Slack body ---
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    let payload = {};
    try { payload = JSON.parse(rawBody); } catch { console.error("❌ Bad JSON"); }

    // --- 2️⃣ Slack verification ---
    if (payload.type === "url_verification" && payload.challenge) {
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3️⃣ Ack early ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4️⃣ Extract message ---
    const ev = payload.event;
    if (!ev || ev.bot_id) return;
    const text = (ev.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- 5️⃣ Env vars ---
    const CYARA_API_URL = process.env.CYARA_API_URL;
    const CYARA_AUTH_TOKEN = process.env.CYARA_AUTH_TOKEN;
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
    console.log("🔍 ENV CHECK", {
      CYARA_API_URL,
      CYARA_AUTH_TOKEN: CYARA_AUTH_TOKEN ? "✅ exists" : "❌ missing",
      SLACK_BOT_TOKEN: SLACK_BOT_TOKEN ? "✅ exists" : "❌ missing",
    });
    if (!CYARA_API_URL || !CYARA_AUTH_TOKEN || !SLACK_BOT_TOKEN) return;

    // --- 6️⃣ Payload identical to Python test ---
    const body = {
      message: text,
      sessionAttributes: {
        product: "voice_assure",
        request_source: "ui",
        auth_token: CYARA_AUTH_TOKEN,
      },
    };
    console.log("📦 Payload:", JSON.stringify(body));

    // --- 7️⃣ Call Cyara API with timeout ---
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const start = Date.now();

    let resp, raw;
    try {
      resp = await fetch(CYARA_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      const ms = Date.now() - start;
      console.log(`⏱️ CYARA responded in ${ms} ms, status: ${resp.status}`);

      raw = await resp.text();
      console.log("📩 CYARA raw response:", raw);
    } catch (err) {
      console.error("🔥 Fetch failed:", err.name, err.message);
      await postFallback(SLACK_BOT_TOKEN, ev.channel, ev.ts);
      return;
    }

    let data;
    try { data = JSON.parse(raw); } catch { data = { message: raw }; }
    const reply = data.reply || data.message || data.response || "⚠️ No reply field in API response.";
    console.log("💬 Reply to Slack:", reply);

    // --- 8️⃣ Send message to Slack ---
    const s = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: ev.channel, text: reply, thread_ts: ev.ts }),
    });
    console.log("📡 Slack API result:", await s.json());
  } catch (e) {
    console.error("🔥 Slack handler exception:", e);
  }
}

// --- fallback helper ---
async function postFallback(token, ch, ts) {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: ch,
        text: "⚠️ Cyara API did not respond. Please try again later.",
        thread_ts: ts,
      }),
    });
  } catch (e) {
    console.error("❌ Fallback post failed:", e);
  }
}
