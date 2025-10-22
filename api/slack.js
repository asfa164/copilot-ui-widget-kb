// ✅ Use Node.js runtime for long network calls
export const runtime = "nodejs";
export const config = { api: { bodyParser: false } };

// --- Dependencies ---
import { WebClient } from "@slack/web-api";

// --- Utility to read Slack raw body ---
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// --- Main handler ---
export default async function handler(req, res) {
  console.log("⚡ Slack event received");

  if (req.method !== "POST") return res.status(200).send("OK");

  try {
    const rawBody = await readRawBody(req);
    const payload = JSON.parse(rawBody);

    // --- Handle Slack verification challenge ---
    if (payload.type === "url_verification" && payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      res.setHeader("Content-Type", "application/json");
      return res.status(200).send(JSON.stringify({ challenge: payload.challenge }));
    }

    // --- Slack requires <3s ack ---
    res.status(200).send("OK");
    console.log("✅ Ack sent to Slack");

    // --- Process event asynchronously ---
    await handleSlackEvent(payload);
  } catch (err) {
    console.error("🔥 Slack handler exception:", err);
    res.status(500).send("Server Error");
  }
}

// --- Async event processing ---
async function handleSlackEvent(payload) {
  const event = payload.event;
  if (!event) return console.log("⚠️ No event found");
  if (event.bot_id || event.subtype === "bot_message")
    return console.log("🤖 Ignored bot message");

  const userQuery = (event.text || "").replace(/<@[^>]+>/g, "").trim();
  console.log("💬 User query:", userQuery);

  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  const AWS_API_GATEWAY_URL = process.env.AWS_API_GATEWAY_URL;
  const API_TOKEN = process.env.API_TOKEN;

  if (!SLACK_BOT_TOKEN || !AWS_API_GATEWAY_URL || !API_TOKEN) {
    console.error("❌ Missing environment variables");
    return;
  }

  const slackClient = new WebClient(SLACK_BOT_TOKEN);

  // --- Step 1: Send immediate acknowledgment message ---
  const placeholder = await slackClient.chat.postMessage({
    channel: event.channel,
    text: "🤖 Processing your request... please hold on.",
    thread_ts: event.ts,
  });

  // --- Step 2: Build Cyara proxy payload ---
  const proxyPayload = {
    query: userQuery,
    sessionAttributes: {
      auth_token: API_TOKEN,
      product: "voice_assure",
      request_source: "ui",
    },
  };
  console.log("📦 Sending payload to AWS proxy:", proxyPayload);

  // --- Step 3: Call AWS API Gateway proxy ---
  const controller = new AbortController();
  const timeoutMs = 25000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const response = await fetch(AWS_API_GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(proxyPayload),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const elapsed = Date.now() - start;
    console.log(`⏱️ AWS Proxy responded in ${elapsed} ms, status: ${response.status}`);

    const text = await response.text();
    console.log("📩 Raw AWS response:", text);

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }

    const reply =
      data.message ||
      data.reply ||
      data.response ||
      "⚠️ The backend returned no valid message.";

    console.log("💬 Final reply:", reply);

    // --- Step 4: Update Slack thread with response ---
    await slackClient.chat.update({
      channel: event.channel,
      ts: placeholder.ts,
      text: reply,
    });

    console.log("✅ Slack message updated successfully");
  } catch (err) {
    console.error("🔥 AWS Proxy fetch failed:", err.name, err.message);
    await slackClient.chat.postMessage({
      channel: event.channel,
      thread_ts: event.ts,
      text: "⚠️ I couldn’t reach Cyara API. Please try again shortly.",
    });
  }
}
