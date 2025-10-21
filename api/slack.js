export const config = {
  api: {
    bodyParser: false, // 👈 disable automatic body parsing
  },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // Read raw body
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  let payload = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = {};
  }

  // ✅ Step 1: Slack URL verification
  if (payload.type === "url_verification" && payload.challenge) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
  }

  // ✅ Step 2: Handle Slack events
  const event = payload.event;
  if (!event) return res.status(200).send("No event");

  // Avoid responding to itself
  if (event.bot_id || event.subtype === "bot_message") {
    return res.status(200).send("Ignored bot message");
  }

  // Process message or app mention
  if (event.type === "app_mention" || event.channel_type === "im") {
    const cleanText = (event.text || "").replace(/<@[^>]+>/g, "").trim();

    try {
      const reply = await getCopilotReply(cleanText);

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
      console.error("Slack event error:", err);
    }
  }

  return res.status(200).send("OK");
}

// --- helper function to query your backend ---
async function getCopilotReply(text) {
  try {
    const resp = await fetch(`${process.env.BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
      },
      body: JSON.stringify({ message: text, source: "slack" }),
    });

    const data = await resp.json();
    return data.reply || data.response || "No response.";
  } catch (e) {
    console.error("Copilot API error:", e);
    return "Error contacting backend.";
  }
}
