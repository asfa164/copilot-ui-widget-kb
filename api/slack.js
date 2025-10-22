// ✅ Node.js runtime for long network and crypto operations
export const runtime = "nodejs";
export const config = { api: { bodyParser: false } };

// --- Dependencies ---
import crypto from "crypto";
import { WebClient } from "@slack/web-api";

// --- Optional for Node 16 (uncomment if needed) ---
// import fetch from "node-fetch";
// import AbortController from "abort-controller";

// --- Utility: read raw body for signature verification ---
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// --- Slack Request Verification ---
function verifySlackRequest(req, rawBody, signingSecret) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];

  if (!timestamp || !slackSignature) {
    console.warn("⚠️ Missing Slack signature headers");
    return false;
  }

  // Protect against replay attacks (5 min)
  if (Math.abs(Date.now() / 1000 - timestamp) > 60 * 5) {
    console.warn("⚠️ Request timestamp too old");
    return false;
  }

  const sigBaseString = `v0:${timestamp}:${rawBody}`;
  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", signingSecret)
      .update(sigBaseString, "utf8")
      .digest("hex");

  const valid = crypto.timingSafeEqual(
    Buffer.from(mySignature, "utf8"),
    Buffer.from(slackSignature, "utf8")
  );

  if (!valid) console.error("❌ Invalid Slack signature");
  return valid;
}

// --- Main Handler ---
export default async function handler(req, res) {
  console.log("⚡ Slack event received");

  if (req.method !== "POST") {
    console.log("⚠️ Non-POST request ignored");
    return res.status(200).send("OK");
  }

  const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  if (!SLACK_SIGNING_SECRET) {
    console.error("❌ Missing SLACK_SIGNING_SECRET");
    return res.status(500).send("Server misconfigured");
  }

  try {
    const rawBody = await readRawBody(req);

    // --- Verify Slack signature ---
    const isVerified = verifySlackRequest(req, rawBody, SLACK_SIGNING_SECRET);
    if (!isVerified) return res.status(403).send("Invalid signature");

    const payload = JSON.parse(rawBody);
    console.log("📨 Incoming Slack payload:", payload);

    // --- Handle Slack challenge (URL verification) ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- Acknowledge immediately ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- Continue async event handling ---
    await handleSlackEvent(payload);
  } catch (err) {
    console.error("🔥 Slack handler exception:", err);
    res.status(500).send("Server Error");
  }
}

// --- Event Processor ---
async function handleSlackEvent(payload) {
  try {
    const event = payload.event;
    if (!event) return console.log("⚠️ No event found in payload");

    // Ignore bot messages
    if (event.bot_id || event.subtype === "bot_message") {
      console.log("🤖 Ignored bot message");
      return;
    }

    const userText = (event.text || "").replace(/<@[^>]+>/g, "").trim();
    const channel = event.channel;
    console.log(`💬 Message from user: ${userText}`);

    // --- Env Vars ---
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
    const AWS_API_GATEWAY_URL = process.env.AWS_API_GATEWAY_URL;
    const API_TOKEN = process.env.API_TOKEN;

    console.log("🔍 ENV CHECK:", {
      SLACK_BOT_TOKEN: !!SLACK_BOT_TOKEN,
      AWS_API_GATEWAY_URL,
      API_TOKEN: !!API_TOKEN,
    });

    if (!SLACK_BOT_TOKEN || !AWS_API_GATEWAY_URL || !API_TOKEN) {
      console.error("❌ Missing environment variables. Cannot proceed.");
      return;
    }

    const slackClient = new WebClient(SLACK_BOT_TOKEN);

    // --- Step 1: Immediate placeholder message ---
    const placeholder = await slackClient.chat.postMessage({
      channel,
      text: "🤖 Processing your request... please hold on.",
      thread_ts: event.ts,
    });

    // --- Step 2: Prepare request payload for AWS ---
    const proxyPayload = {
      query: userText,
      sessionAttributes: {
        auth_token: API_TOKEN,
        product: "voice_assure",
        request_source: "slack",
      },
    };
    console.log("📦 Sending payload to AWS:", proxyPayload);

    // --- Step 3: Call AWS API Gateway ---
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    const start = Date.now();

    const response = await fetch(AWS_API_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proxyPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    console.log(`⏱️ AWS responded in ${elapsed} ms, status: ${response.status}`);

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { message: responseText };
    }

    const reply =
      data.message ||
      data.reply ||
      data.response ||
      "⚠️ No valid message returned from backend.";

    console.log("💬 Final reply:", reply);

    // --- Step 4: Update Slack message ---
    await slackClient.chat.update({
      channel,
      ts: placeholder.ts,
      text: reply,
    });

    console.log("✅ Slack message updated successfully");
  } catch (err) {
    console.error("🔥 Event processing error:", err);
    try {
      const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN);
      await slackClient.chat.postMessage({
        channel: payload?.event?.channel || "",
        thread_ts: payload?.event?.ts,
        text: "⚠️ I encountered an internal error. Please try again shortly.",
      });
    } catch (e) {
      console.error("🔥 Failed to send fallback message:", e);
    }
  }
}
