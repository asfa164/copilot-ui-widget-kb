import crypto from "crypto";
import fetch from "node-fetch";

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const CYARA_API_URL =
  process.env.CYARA_API_URL ||
  "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external";

/** ✅ Verify Slack signature (same as Flask version) */
function verifySlackRequest(headers, rawBody) {
  const timestamp = headers.get("x-slack-request-timestamp");
  const slackSignature = headers.get("x-slack-signature");

  // Reject old requests (older than 5 min)
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

/** ✅ Send message to Slack */
async function postMessage(channel, text) {
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
  else console.log("✅ Message posted:", data.ts);
}

/** ✅ Handle NLU call (replaces nlu_engine.get_nlu_response) */
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
    console.error("❌ NLU call error:", err);
    return "⚠️ Error contacting backend.";
  }
}

/** ✅ Main handler (Next.js App Router) */
export async function POST(req) {
  const rawBody = await req.text();

  // --- Verify Slack signature ---
  if (!verifySlackRequest(req.headers, rawBody)) {
    console.error("⚠️ Invalid Slack signature");
    return new Response("Invalid signature", { status: 403 });
  }

  const data = JSON.parse(rawBody || "{}");
  console.log("📨 Incoming Slack event:", data);

  // 1️⃣ URL verification
  if (data.challenge) {
    console.log("🔹 URL verification challenge");
    return Response.json({ challenge: data.challenge });
  }

  const event = data.event || {};

  // 2️⃣ File upload event
  if (event.type === "event_callback" && event.files) {
    console.log("📁 File upload event received");
    // Integrate file_import_from_slack logic here if needed
    const reply = "📂 File received and processed.";
    await postMessage(event.channel, reply);
    return new Response("", { status: 200 });
  }

  // 3️⃣ Message event (ignore bot messages)
  if (event.type === "message" && !event.bot_id) {
    console.log("💬 Message from Slack:", event.text);

    // Immediately acknowledge
    const ack = new Response("", { status: 200 });

    // Process asynchronously
    (async () => {
      const reply = await getNluResponse(event.text);
      await postMessage(event.channel, reply);
    })();

    return ack;
  }

  console.log("ℹ️ Event ignored or unsupported.");
  return new Response("", { status: 200 });
}

/** --- Helper --- */
function tryParseJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
