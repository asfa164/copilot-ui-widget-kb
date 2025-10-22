// api/chat.js
export default async function handler(req, res) {
  // --- Validate method ---
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const slackToken = process.env.SLACK_BOT_TOKEN
  const upstream = process.env.CYARA_API_URL || "https://7jfvvi4m0g.execute-api.us-east-1.amazonaws.com/api/dev/external"

  try {
    const bodyText = await streamToString(req)
    const data = JSON.parse(bodyText)

    // 1️⃣ --- Slack URL verification ---
    if (data.challenge) {
      console.log("🔹 Slack URL verification received")
      return res.status(200).json({ challenge: data.challenge })
    }

    const event = data.event || {}

    // 2️⃣ --- Handle Slack message event ---
    if (event.type === "message" && !event.bot_id) {
      console.log("💬 Message from Slack:", event.text)

      // Respond immediately to Slack (ack)
      res.status(200).end()

      // Async processing (fire and forget)
      handleSlackMessage(event, slackToken, upstream)
      return
    }

    // 3️⃣ --- Handle Slack file upload event ---
    if (event.type === "event_callback" && event.files) {
      console.log("📁 File upload event from Slack")
      return res.status(200).end()
    }

    // 4️⃣ --- Fallback to your original chat proxy ---
    const { query, token } = data || {}
    const expected = process.env.API_TOKEN

    if (!expected || !upstream)
      return res.status(500).json({ error: "Missing API_TOKEN or CYARA_API_URL" })

    if (!token || token !== expected)
      return res.status(401).json({ error: "Unauthorized" })

    if (!query || typeof query !== "string")
      return res.status(400).json({ error: 'Missing "query" string' })

    const payload = { query }

    const upstreamRes = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })

    const upstreamText = await upstreamRes.text()
    const upstreamParsed = tryParseJSON(upstreamText) ?? upstreamText
    const message = extractMessage(upstreamParsed) ?? "No message found."

    return res.status(upstreamRes.status || 200).json({ message, raw: upstreamParsed })
  } catch (e) {
    console.error("Handler error:", e)
    return res.status(500).json({ error: "Internal Server Error", details: e.message })
  }
}

// --- Helpers ---

async function handleSlackMessage(event, slackToken, upstream) {
  try {
    const query = event.text
    const channel = event.channel

    const nluRes = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
    })

    const text = await nluRes.text()
    let reply
    try {
      const parsed = JSON.parse(text)
      reply = parsed.reply || parsed.message || "⚠️ No valid message."
    } catch {
      reply = text
    }

    await postToSlack(channel, reply, slackToken)
  } catch (err) {
    console.error("Slack message handler error:", err)
  }
}

async function postToSlack(channel, text, token) {
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ channel, text }),
  })
}

// Converts stream to string (for Vercel body reading)
async function streamToString(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return Buffer.concat(chunks).toString("utf8")
}

function tryParseJSON(s) {
  if (typeof s !== "string") return null
  try { return JSON.parse(s) } catch { return null }
}

function extractMessage(obj) {
  if (typeof obj === "string") {
    const parsed = tryParseJSON(obj)
    if (parsed) return extractMessage(parsed)
    return null
  }
  if (!obj || typeof obj !== "object") return null
  if (typeof obj.message === "string" && obj.message.trim()) return obj.message
  if (typeof obj.messageText === "string" && obj.messageText.trim()) return obj.messageText
  if (obj.body) {
    const body = typeof obj.body === "string" ? tryParseJSON(obj.body) ?? obj.body : obj.body
    const inner = extractMessage(body)
    if (inner) return inner
  }
  if (Array.isArray(obj.messages) && obj.messages.length) {
    const first = obj.messages[0]
    if (typeof first?.content === "string" && first.content.trim()) return first.content
  }
  return null
}
