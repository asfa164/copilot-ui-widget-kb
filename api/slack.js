import crypto from "crypto";
import fetch from "node-fetch";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CYARA_API_URL =
  process.env.CYARA_API_URL ||
  "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";

// --- Verify Slack signature ---
function verifySlackRequest(headers, rawBody) {
  const timestamp = headers.get("x-slack-request-timestamp");
  const slackSignature = headers.get("x-slack-signature");

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;

  const sigBase = `v0:${timestamp}:${rawBody}`;
  const mySig =
    "v0=" +
    crypto.createHmac("sha256", SLACK_SIGNING_SECRET).update(sigBase).digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySig, "utf8"),
    Buffer.from(slackSignature, "utf8")
  );
}

// --- Post message to Slack ---
async function postToSlack(channel, text) {
  try {
    const res = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel, text }),
    });
    const data = await res.json();
    if (!data.ok) console.error("❌ Slack post failed:", data);
    else console.log("✅ Sent to Slack:", data.ts);
  } catch (err) {
    console.error("❌ Slack post error:", err);
  }
}

// --- Get clean NLU response ---
async function getNluResponse(query) {
  try {
    const res = await fetch(CYARA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });

    const text = await res.text();
    const parsed = tryParseJSON(text);

    // Extract message field cleanly
    if (parsed?.message) return parsed.message;
    if (parsed?.reply) return parsed.reply;

    // Handle nested message JSONs
    if (typeof parsed === "object") {
      const msg = Object.values(parsed).find(v => typeof v === "string" && v.length < 1000);
      if (msg) return msg;
    }

    return text;
  } catch (err) {
    console.error("❌ NLU error:", err);
    return "⚠️ Error contacting backend.";
  }
}

export async function POST(req) {
  const rawBody = await req.text();

  // Verify Slack
  if (!verifySlackRequest(req.headers, rawBody)) {
    console.error("⚠️ Invalid Slack signature");
    return new Response("Invalid signature", { status: 403 });
  }

  const data = JSON.parse(rawBody || "{}");
  const event = data.event || {};

  // URL Verification
  if (data.challenge) return Response.json({ challenge: data.challenge });

  // ⚡ IMMEDIATE ACK — so Slack doesn’t timeout
  const ack = new Response("", { status: 200 });

  // Handle messages asynchronously
  if (event.type === "message" && !event.bot_id) {
    console.log("💬 Message:", event.text);
    queueMicrotask(async () => {
      const reply = await getNluResponse(event.text);
      const cleanReply =
        typeof reply === "string" && reply.startsWith("{")
          ? "⚙️ Sorry, I received an invalid response format."
          : reply;

      await postToSlack(event.channel, cleanReply);
    });
  }

  // Handle file uploads
  if (event.type === "event_callback" && event.files) {
    console.log("📁 File upload event:", event.files.map(f => f.name));
    queueMicrotask(async () => {
      await postToSlack(event.channel, "📂 File received — processing...");
    });
  }

  return ack;
}

function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
