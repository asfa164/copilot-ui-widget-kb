// /api/slack.js

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // --- Parse body safely ---
  let body = "";
  await new Promise((resolve) => {
    req.on("data", (chunk) => (body += chunk.toString()));
    req.on("end", resolve);
  });

  let payload = {};
  try {
    payload = JSON.parse(body);
  } catch (e) {
    console.log("Non-JSON body, skipping parse");
  }

  // --- ✅ Step 1: Handle Slack's verification challenge ---
  if (payload && payload.type === "url_verification" && payload.challenge) {
    console.log("Responding to Slack URL verification");
    return res.status(200).json({ challenge: payload.challenge });
  }

  // --- ✅ Step 2: Handle Slack events (normal flow) ---
  const event = payload.event;
  if (!event) return res.status(200).send("No event");

  // Ignore bot messages to prevent loops
  if (event.bot_id || event.subtype === "bot_message") {
    return res.status(200).send("Ignored bot message");
  }

  // Handle messages or mentions
  if (event.type === "app_mention" || event.channel_type === "im") {
    const userText = (event.text || "").replace(/<@[^>]+>/g, "").trim();

    try {
      const aiResponse = await fetch(`${process.env.BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
        },
        body: JSON.stringify({ message: userText, source: "slack" }),
      });

      const data = await aiResponse.json();
      const reply =
        data.reply || data.response || "Sorry, I couldn’t generate a reply.";

      // Send back to Slack
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

  res.status(200).send("OK");
}
