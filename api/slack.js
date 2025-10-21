// Disable body parsing (Slack needs raw body for url_verification)
export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  console.log("⚡ Incoming Slack request");

  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  try {
    // --- 1) Read raw body (important for Slack verification) ---
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

    // --- 2) Slack URL verification ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- 3) Ack immediately (Slack requires <3s) ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- 4) Extract the event ---
    const event = payload.event;
    if (!event) return console.log("⚠️ No event object found");
    if (event.bot_id || event.subtype === "bot_message") return console.log("🤖 Ignored bot message");

    // DM or mention text (strip mention tags if present)
    const text = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    console.log("💬 User text:", text);

    // --- 5) Verify required env vars for your backend ---
    const base = (process.env.BASE_URL || "").replace(/\/+$/, "");
    const url = `${base}/api/chat`;
    const apiToken = process.env.API_TOKEN;
    const slackToken = process.env.SLACK_BOT_TOKEN;

    console.log("🔍 ENV CHECK", {
      BASE_URL: base || "❌ missing",
      API_TOKEN: apiToken ? "✅ exists" : "❌ missing",
      SLACK_BOT_TOKEN: slackToken ? "✅ exists" : "❌ missing",
    });

    if (!base || !apiToken || !slackToken) {
      console.error("❌ Missing env vars; cannot proceed");
      return;
    }

    // --- 6) Call your /api/chat with the EXPECTED SHAPE { query, token } ---
    console.log("🧭 Calling Copilot endpoint:", url);

    let aiResp;
    try {
      aiResp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // IMPORTANT: chat.js expects token in the body, not Authorization header
        },
        body: JSON.stringify({
          query: text,      // <-- what chat.js expects
          token: apiToken,  // <-- what chat.js expects
        }),
      });
    } catch (err) {
      console.error("🔥 Network/Fetch error:", err.message);
      await postFallback(slackToken, event.channel, event.ts);
      return;
    }

    if (!aiResp) {
      console.error("❌ No response received from backend");
      await postFallback(slackToken, event.channel, event.ts);
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

    // Your chat.js will likely return something like { reply: "...", ... }
    const reply =
      data.reply ||
      data.response ||
      (aiResp.status === 401
        ? "⚠️ Unauthorized to reach Copilot. Check API token."
        : `No valid reply (status ${aiResp.status})`);
    console.log("💬 Reply to Slack:", reply);

    // --- 7) Post reply back to Slack (in thread for channel messages; same ts for DMs is fine) ---
    const slackResp = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${slackToken}`,
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
    try {
      return res.status(200).send("Error");
    } catch {}
  }
}

// Fallback reply helper
async function postFallback(botToken, channel, threadTs) {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${botToken}`,
      },
      body: JSON.stringify({
        channel,
        text: "⚠️ Sorry, I couldn't reach Cyara Copilot right now. Please try again shortly.",
        thread_ts: threadTs,
      }),
    });
  } catch (e) {
    console.error("❌ Failed to post fallback to Slack:", e);
  }
}
