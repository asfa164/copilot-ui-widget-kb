// ✅ Use Node.js runtime for long network operations
export const runtime = "nodejs";
export const config = { api: { bodyParser: false } };

// --- Imports ---
import crypto from "crypto";
import { WebClient } from "@slack/web-api";
import fetch from "node-fetch";

// --- Helper: Read raw request body ---
async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// --- Verify Slack Signature ---
function verifySlackRequest(req, rawBody, signingSecret) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];
  if (!timestamp || !slackSignature) {
    console.warn("⚠️ Missing Slack headers");
    return false;
  }

  // Protect against replay (5 min)
  if (Math.abs(Date.now() / 1000 - timestamp) > 60 * 5) {
    console.warn("⚠️ Request too old");
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

// --- Send a message to Slack ---
async function postMessage(token, channel, text, thread_ts) {
  const slackClient = new WebClient(token);
  await slackClient.chat.postMessage({
    channel,
    text,
    thread_ts,
  });
}

// --- Update a Slack message ---
async function updateMessage(token, channel, ts, text) {
  const slackClient = new WebClient(token);
  await slackClient.chat.update({
    channel,
    ts,
    text,
  });
}

// --- Main Handler ---
export default async function handler(req, res) {
  console.log("⚡ Slack event received");

  if (req.method !== "POST") return res.status(200).send("OK");

  const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
  const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
  const AWS_API_GATEWAY_URL = process.env.AWS_API_GATEWAY_URL;
  const API_TOKEN = process.env.API_TOKEN;

  try {
    const rawBody = await readRawBody(req);
    if (!verifySlackRequest(req, rawBody, SLACK_SIGNING_SECRET)) {
      return res.status(403).send("Invalid signature");
    }

    const payload = JSON.parse(rawBody);
    console.log("📨 Incoming event:", payload);

    // --- Slack URL Verification ---
    if (payload.challenge) {
      console.log("✅ Responding to Slack challenge");
      return res.status(200).json({ challenge: payload.challenge });
    }

    const event = payload.event || {};
    if (!event) return res.status(200).send("No event");

    // --- Acknowledge immediately ---
    res.status(200).send("OK");

    // --- Handle Message Events ---
    if (event.type === "message" && !event.bot_id) {
      console.log("💬 Message event received:", event.text);

      const channel = event.channel;
      const ts = event.ts;
      const userQuery = (event.text || "").trim();

      // Step 1: Send placeholder message
      const slackClient = new WebClient(SLACK_BOT_TOKEN);
      const placeholder = await slackClient.chat.postMessage({
        channel,
        text: "🤖 Processing your request... please hold on.",
        thread_ts: ts,
      });

      // Step 2: Prepare AWS payload
      const proxyPayload = {
        query: userQuery,
        sessionAttributes: {
          auth_token: API_TOKEN,
          product: "voice_assure",
          request_source: "slack",
        },
      };

      console.log("📦 Sending payload to AWS:", proxyPayload);

      // Step 3: Send request to AWS
      try {
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

        const text = await response.text();
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

        // Step 4: Update Slack message
        await slackClient.chat.update({
          channel,
          ts: placeholder.ts,
          text: reply,
        });

        console.log("✅ Slack message updated successfully");
      } catch (err) {
        console.error("🔥 AWS request failed:", err);
        await postMessage(
          SLACK_BOT_TOKEN,
          channel,
          "⚠️ Unable to reach the backend. Please try again later.",
          ts
        );
      }
    } else {
      console.log("⚠️ Non-message or bot event ignored");
    }
  } catch (err) {
    console.error("🔥 Handler error:", err);
    res.status(500).send("Server Error");
  }
}
