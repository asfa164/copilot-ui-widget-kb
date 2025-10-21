// /api/slack.js
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Read raw body (Vercel's serverless doesn't auto-parse)
  const raw = await new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk.toString()));
    req.on("end", () => resolve(data || ""));
  });

  const ct = req.headers["content-type"] || "";
  let payload = {};

  try {
    if (ct.includes("application/json")) {
      payload = raw ? JSON.parse(raw) : {};
    } else if (ct.includes("application/x-www-form-urlencoded")) {
      payload = Object.fromEntries(new URLSearchParams(raw));
      // If Slack wrapped JSON as 'payload', unwrap it (used by some interactions)
      if (payload.payload) {
        payload = JSON.parse(payload.payload);
      }
    }
  } catch (e) {
    console.error("Body parse error:", e);
    return res.status(400).json({ error: "Invalid body" });
  }

  // 1) URL Verification
  if (payload && payload.challenge) {
    return res.status(200).json({ challenge: payload.challenge });
  }

  // 2) Events API
  const event = payload.event;
  if (!event) {
    // Could be a slash command or other type later; just ack.
    return res.status(200).end();
  }

  // Avoid bot loops
  if (event.bot_id || event.subtype === "bot_message") {
    return res.status(200).end();
  }

  // Only handle app mentions in channels or direct messages to the bot
  const isMention = event.type === "app_mention";
  const isDM = event.channel_type === "im";

  if (isMention || isDM) {
    // Strip bot mention from the text for cleaner query
    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();

    try {
      // Call your backend chat endpoint
      const resp = await fetch(`${process.env.BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
        },
        body: JSON.stringify({
          message: text,
          source: "slack",
        }),
      });

      const data = await resp.json();
      const reply =
        data.reply || data.response || "Sorry, I couldn’t generate a reply.";

      // Post message back to Slack (in-thread)
      await fetch("https://slack.com/api/chat.postMessage", {
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
    } catch (err) {
      console.error("Slack bot error:", err);
    }
  }

  // Always 200 within 3s to keep Slack happy
  return res.status(200).end();
}
