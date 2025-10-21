// api/chat.js
export default async function handler(req, res) {
  // --- Validate method ---
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { query, token } = req.body || {}
    const expected = process.env.API_TOKEN
    const upstream = process.env.CYARA_API_URL

    // --- Validate configuration ---
    if (!expected || !upstream) {
      return res.status(500).json({
        error: 'Server not configured: missing API_TOKEN or CYARA_API_URL'
      })
    }

    // --- Validate auth token ---
    if (!token || token !== expected) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // --- Validate query ---
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing "query" string' })
    }

    // --- Compose upstream payload ---
    const payload = {
      query,
      sessionAttributes: {
        auth_token: token,            // internal token for backend auth
        product: 'voice_assure',
        request_source: 'ui'
      }
    }

    // --- Clean headers to avoid AWS SigV4 auto-signing ---
    const headers = new Headers()
    headers.set('Content-Type', 'application/json')
    headers.delete('Authorization')
    headers.delete('X-Amz-Date')
    headers.delete('X-Amz-Security-Token')
    headers.delete('X-Amz-Content-Sha256')

    // Optional debug for Vercel logs
    // console.log('➡️ Sending to:', upstream, 'Headers:', Object.fromEntries(headers.entries()))

    // --- Call upstream endpoint ---
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    })

    const upstreamText = await upstreamRes.text()

    // --- Parse response safely ---
    const upstreamParsed = tryParseJSON(upstreamText) ?? upstreamText
    const message = extractMessage(upstreamParsed) ?? 'No message found.'

    // --- Return normalized response ---
    return res.status(upstreamRes.status || 200).json({
      message,
      raw: upstreamParsed
    })
  } catch (e) {
    return res.status(500).json({
      error: 'Proxy error',
      details: e?.message || e
    })
  }
}

// --- Helpers ---

function tryParseJSON(s) {
  if (typeof s !== 'string') return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function extractMessage(obj) {
  // string → maybe JSON string → try again
  if (typeof obj === 'string') {
    const parsed = tryParseJSON(obj)
    if (parsed) return extractMessage(parsed)
    return null
  }

  if (!obj || typeof obj !== 'object') return null

  // Common fields
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
  if (typeof obj.messageText === 'string' && obj.messageText.trim())
    return obj.messageText

  // AWS/Lambda wrapper
  if (obj.body) {
    const body =
      typeof obj.body === 'string'
        ? tryParseJSON(obj.body) ?? obj.body
        : obj.body
    const inner = extractMessage(body)
    if (inner) return inner
  }

  // Bedrock/LLM-like response arrays
  if (Array.isArray(obj.messages) && obj.messages.length) {
    const first = obj.messages[0]
    if (typeof first?.content === 'string' && first.content.trim())
      return first.content
  }

  return null
}
