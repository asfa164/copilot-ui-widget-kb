// Disable body parsing (Slack needs raw body)
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  console.log("⚡ Incoming Slack request");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // --- 1️⃣ Read raw body ---
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");
    console.log("🔹 Raw body:", rawBody);

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error("❌ JSON parse error:", err);
    }

    // --- 2️⃣ Slack URL verification ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3️⃣ Acknowledge Slack immediately ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4️⃣ Extract event ---
    const event = payload.event;
    if (!event) return console.log("⚠️ No event object found");
    if (event.bot_id || event.subtype === "bot_message") return console.log("🤖 Ignored bot message");

    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- 5️⃣ Check environment variables ---
    console.log("🔍 ENV CHECK", {
      BASE_URL: process.env.BASE_URL,
      API_TOKEN: process.env.API_TOKEN ? "✅ exists" : "❌ missing",
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ? "✅ exists" : "❌ missing",
    });

    // --- 6️⃣ Call Copilot backend ---
    const base = process.env.BASE_URL.replace(/\/+$/, "");
    const url = `${base}/api/chat`;
    console.log("🧭 Calling Copilot endpoint:", url);

    let aiResp;
    try {
      aiResp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.API_TOKEN}`,
        },
        body: JSON.stringify({ message: text, source: "slack" }),
      });
    } catch (err) {
      console.error("🔥 Network/Fetch error:", err.message);
      aiResp = null;
    }

    if (!aiResp) {
      console.error("❌ No response received from backend");
      return;
    }

    console.log("🛰️ Copilot backend HTTP status:", aiResp.status);

    let data = {};
    try {
      data = await aiResp.json();
      console.log("📥 Copilot backend response:", data);
    } catch (err) {
      console.error("❌ Failed to parse Copilot JSON:", err.message);
    }

    const reply = data.reply || data.response || `No valid reply (status ${aiResp.status})`;
    console.log("💬 Reply to Slack:", reply);

    // --- 7️⃣ Send reply to Slack ---
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: event.channel,
        text: reply,
        thread_ts: event.ts, // reply in thread
      }),
    });

    const slackResult = await slackResp.json();
    console.log("📡 Slack API result:", slackResult);
  } catch (err) {
    console.error("🔥 Slack handler exception:", err);
    try {
      return res.status(200).send("Error");
    } catch {}
  }
}
