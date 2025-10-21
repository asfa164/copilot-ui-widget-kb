// --- Disable body parsing so Slack's raw request isn't corrupted ---
export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  // Read the raw request body exactly as Slack sends it
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString("utf8");

  let payload = {};
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("Parse error:", err);
  }

  // ✅ Step 1: respond to Slack’s URL verification challenge
  if (payload?.type === "url_verification" && payload?.challenge) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).end(JSON.stringify({ challenge: payload.challenge }));
  }

  // ✅ Step 2: immediately ack all other requests
  res.status(200).send("OK");
}
