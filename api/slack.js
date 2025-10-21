// Disable body parsing (Slack needs raw body)
export const config = { api: { bodyParser: false } };

// Slack Event Handler
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

    // --- 2️⃣ Handle Slack URL verification ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3️⃣ Ack immediately (must reply <3s) ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4️⃣ Extract event ---
    const event = payload.event;
    if (!event) return console.log("⚠️ No event object found");
    if (event.bot_id || event.subtype === "bot_message") return console.log("🤖 Ignored bot message");

    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- 5️⃣ Verify environment variables ---
    console.log("🔍 ENV CHECK", {
      BASE_URL: process.env.BASE_URL,
      AUTH_TOKEN: process.env.AUTH_TOKEN ? "✅ exists" : "❌ missing",
      SLACK_BOT_TOKEN: process.env.SLACK_BOT_TOKEN ? "✅ exists" : "❌ missing",
    });

    // --- 6️⃣ Send to your backend (Copilot Chat) ---
    const aiResp = await fetch(`${process.env.BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ message: text, source: "slack" }),
    }).catch((err) => {
      console.error("🔥 Copilot request error:", err);
      return null;
    });

    if (!aiResp) return console.error("❌ Copilot backend unreachable");

    console.log("🛰️ Sent to Copilot backend:", aiResp.status);
    const data = await aiResp.json().catch((err) => {
      console.error("❌ Error parsing Copilot JSON:", err);
      return {};
    });

    console.log("📥 Copilot reply data:", data);

    const reply = data.reply || data.response || "No response received.";
    console.log("💬 Reply to Slack:", reply);

    // --- 7️⃣ Post reply to Slack ---
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: event.channel,
        text: reply,
        thread_ts: event.ts, // replies in same thread if applicable
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
