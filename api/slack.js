import crypto from "crypto";


const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CYARA_API_URL =
  process.env.CYARA_API_URL ||
  "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";

function verifySlackRequest(headers, rawBody) {
  const ts = headers.get("x-slack-request-timestamp");
  const sig = headers.get("x-slack-signature");
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

async function getNluResponse(query) {
  try {
    const r = await fetch(CYARA_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    });
    const t = await r.text();
    const j = tryParseJSON(t);
    return j?.message || j?.reply || t;
  } catch (e) {
    console.error("NLU fail:", e);
    return "⚠️ NLU service error.";
  }
}

async function postToSlack(channel, text) {
  const r = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ channel, text }),
  });
  const d = await r.json();
  if (!d.ok) console.error("Slack post failed:", d);
  else console.log("✅ Sent to Slack:", d.ts);
}

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
    const reply = await getNluResponse(event.text);
    await postToSlack(event.channel, reply);
  }

  return new Response("", { status: 200 });
}
