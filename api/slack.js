import crypto from "crypto";


const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CYARA_API_URL =
  process.env.CYARA_API_URL ||
  "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";

/** Verify Slack request (HMAC) */
function verifySlackRequest(headers, rawBody) {
  const timestamp = headers.get("x-slack-request-timestamp");
  const slackSignature = headers.get("x-slack-signature");

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", SLACK_SIGNING_SECRET)
      .update(sigBaseString)
      .digest("hex");

  return crypto.timingSafeEqual(
    Buffer.from(mySignature, "utf8"),
    Buffer.from(slackSignature, "utf8")
  );
}

/** Post message to Slack */
async function postMessage(channel, text) {
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
    else console.log("✅ Slack message posted:", data.ts);
  } catch (err) {
    console.error("❌ Slack post error:", err);
  }
}

/** Call external NLU API */
async function getNluResponse(query) {
  try {
    const res = await fetch(CYARA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await res.text();
    const parsed = tryParseJSON(text);
    return parsed?.reply || parsed?.message || text;
  } catch (err) {
    console.error("❌ NLU call failed:", err);
    return "⚠️ Error contacting backend.";
  }
}

export async function POST(req) {
  const rawBody = await req.text();

  // 🛡️ Verify signature
  if (!verifySlackRequest(req.headers, rawBody)) {
    console.error("⚠️ Invalid Slack signature");
    return new Response("Invalid signature", { status: 403 });
  }

  const data = JSON.parse(rawBody || "{}");
  const event = data.event || {};

  // 🔹 URL verification
  if (data.challenge) {
    return Response.json({ challenge: data.challenge });
  }

  // ⚡ IMMEDIATE ACK
  const ack = new Response("", { status: 200 });

  // Handle message event asynchronously
  if (event.type === "message" && !event.bot_id) {
    console.log("💬 Slack message:", event.text);
    queueMicrotask(async () => {
      const reply = await getNluResponse(event.text);
      await postMessage(event.channel, reply);
    });
  }

  // Handle file upload event (optional)
  if (event.type === "event_callback" && event.files) {
    console.log("📁 Slack file upload:", event.files.map(f => f.name));
    queueMicrotask(async () => {
      await postMessage(event.channel, "📂 File received and will be processed.");
    });
  }

  return ack;
}

/** JSON parser helper */
function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
