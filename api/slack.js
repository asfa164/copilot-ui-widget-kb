import crypto from "crypto";


const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CYARA_API_URL =
  process.env.CYARA_API_URL ||
  "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";

// Verify Slack request (HMAC)
function verifySlackRequest(headers, rawBody) {
  const ts = headers.get("x-slack-request-timestamp");
  const sig = headers.get("x-slack-signature");
  if (!ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 60 * 5) return false;

  const base = `v0:${ts}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", SLACK_SIGNING_SECRET)
    .update(base)
    .digest("hex");
  const mySig = `v0=${hmac}`;
  return crypto.timingSafeEqual(
    Buffer.from(mySig, "utf8"),
    Buffer.from(sig, "utf8")
  );
}

// Post message to Slack
async function postToSlack(channel, text) {
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
}

// Extract only the `message` field from NLU JSON
async function getNluMessage(query) {
  try {
    const r = await fetch(CYARA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const text = await r.text();
    const json = tryParseJSON(text);

    if (json && typeof json === "object" && json.message)
      return json.message.trim();

    return (
      (typeof text === "string" && text.trim()) ||
      "⚠️ No valid message field found in response."
    );
  } catch (e) {
    console.error("NLU call failed:", e);
    return "⚠️ Error contacting backend.";
  }
}

// Parse JSON safely
function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function POST(req) {
  const raw = await req.text();
  if (!verifySlackRequest(req.headers, raw))
    return new Response("invalid", { status: 403 });

  const body = JSON.parse(raw || "{}");
  if (body.challenge) return Response.json({ challenge: body.challenge });

  const event = body.event || {};
  if (event.type === "message" && !event.bot_id) {
    console.log("💬 Message:", event.text);
    const msg = await getNluMessage(event.text);
    await postToSlack(event.channel, msg);
  }

  return new Response("", { status: 200 });
}
