export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  console.log("⚡ Incoming Slack request");
  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    // read raw body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    console.log("🔹 Raw body:", raw);

    let payload = {};
    try {
      payload = JSON.parse(raw);
    } catch (err) {
      console.error("❌ JSON parse error:", err);
    }

    // URL verification
    if (payload.type === "url_verification") {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // Acknowledge immediately
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    const event = payload.event;
    if (!event) return console.log("⚠️ No event object found");
    if (event.bot_id || event.subtype === "bot_message") return console.log("🤖 Ignored bot message");

    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- send to your backend ---
    const aiResp = await fetch(`${process.env.BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ message: text, source: "slack" }),
    });

    console.log("🛰️ Sent to Copilot backend:", aiResp.status);
    const data = await aiResp.json().catch(() => ({}));
    console.log("📥 Copilot reply data:", data);

    const reply = data.reply || data.response || "No response received.";
    console.log("💬 Reply to Slack:", reply);

    // --- post message back to Slack ---
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
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
