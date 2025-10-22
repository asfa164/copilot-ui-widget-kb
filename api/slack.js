import express from "express";
import fetch from "node-fetch"; // npm install express node-fetch
import bodyParser from "body-parser";

const app = express();
app.use(bodyParser.json());

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN; // your bot token from Slack
const PORT = process.env.PORT || 3000;

// Helper to send message back to Slack
async function postMessage(channel, text) {
  const url = "https://slack.com/api/chat.postMessage";
  const payload = { channel, text };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!data.ok) console.error("❌ Failed to post message:", data);
  else console.log("✅ Message sent to Slack:", data.ts);
}

// Helper to get NLU response
async function getNluResponse(query) {
  const url = "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";
  const payload = { query };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return data.reply || data.message || "⚠️ No valid reply from backend.";
  } catch (err) {
    console.error("Error calling NLU endpoint:", err);
    return "⚠️ Error contacting NLU service.";
  }
}

// Main route to receive Slack events
app.post("/slack/events", async (req, res) => {
  const data = req.body;

  // === Step 1: Handle Slack URL Verification ===
  if (data.challenge) {
    console.log("🔹 URL verification challenge received");
    return res.json({ challenge: data.challenge });
  }

  const event = data.event || {};

  // === Step 2: Handle File Upload Event ===
  if (event.type === "event_callback" && event.files) {
    console.log("📁 File upload event received");
    return res.sendStatus(200);
  }

  // === Step 3: Handle Message Event ===
  if (event.type === "message" && !event.bot_id) {
    console.log("💬 Message received:", event.text);
    const { text, channel } = event;

    // Respond quickly to Slack to avoid timeout
    res.sendStatus(200);

    // Process in background
    (async () => {
      const reply = await getNluResponse(text);
      await postMessage(channel, reply);
    })();
    return;
  }

  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🚀 Slack bot server running on port ${PORT}`));
