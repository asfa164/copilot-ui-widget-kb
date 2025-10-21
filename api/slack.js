// Disable automatic body parsing (Slack needs raw body)
export const config = {
  api: { bodyParser: false },
};

// Main Slack event handler
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // --- Read raw request body ---
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    let payload = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      payload = {};
    }

    // --- Handle Slack URL verification ---
    if (payload.type === "url_verification" && payload.challenge) {
      res.setHeader("Content-Type", "application/json");
      return res
        .status(200)
        .send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- Acknowledge Slack immediately ---
    res.status(200).send("OK");

    // --- Process events asynchronously ---
    const event = payload.event;
    if (!event) return;

    // Ignore bot messages to prevent loops
    if (event.bot_id || event.subtype === "bot_message") return;

    // Clean user text
    const userText = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    const channel = event.channel;

    // --- Query your backend (Copilot) for a reply ---
    const aiResponse = await fetch(`${process.env.BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ message: userText, source: "slack" }),
    });

    const data = await aiResponse.json();
    const replyText = data.reply || data.response || "No response.";

    // --- Send reply to Slack ---
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel,
        text: replyText,
        thread_ts: event.ts, // reply in thread
      }),
    });
  } catch (err) {
    console.error("Slack handler error:", err);
    // Slack requires a 200 response even on errors
    try {
      return res.status(200).send("Error");
    } catch {}
  }
}
