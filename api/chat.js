// api/chat.js
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { query, token } = req.body || {}
    const expected = process.env.API_TOKEN
    const upstream = process.env.CYARA_API_URL

    if (!expected || !upstream) {
      return res.status(500).json({ error: 'Server not configured: missing API_TOKEN or CYARA_API_URL' })
    }
    if (!token || token !== expected) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Missing "query" string' })
    }

    // Compose the upstream payload
    const payload = {
      query,
      sessionAttributes: {
        auth_token: token,
        product: 'voice_assure',
        request_source: 'ui'
      }
    }

    // Call upstream (hidden from client)
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },

      body: JSON.stringify(payload)
    })

    const upstreamText = await upstreamRes.text()

    // Try to parse JSON; fall back to raw text
    const upstreamParsed = tryParseJSON(upstreamText) ?? upstreamText

    // Extract a message from any reasonable shape
    const message =
      extractMessage(upstreamParsed) ??
      'No message found.'

    // Return both normalized message and the full upstream payload for debugging
    return res.status(upstreamRes.status || 200).json({
      message,
      raw: upstreamParsed
    })

  } catch (e) {
    return res.status(500).json({ error: 'Proxy error', details: e?.message })
  }
}

function tryParseJSON(s) {
  if (typeof s !== 'string') return null
  try { return JSON.parse(s) } catch { return null }
}

function extractMessage(obj) {
  // Accept string -> maybe JSON string; otherwise treat as text fallback
  if (typeof obj === 'string') {
    const parsed = tryParseJSON(obj)
    if (parsed) return extractMessage(parsed)
    // string but not JSON; don’t treat as “message” (let caller decide)
    return null
  }
  if (!obj || typeof obj !== 'object') return null

  // Common fields
  if (typeof obj.message === 'string' && obj.message.trim()) return obj.message
  if (typeof obj.messageText === 'string' && obj.messageText.trim()) return obj.messageText

  // AWS/Lambda wrapper
  if (obj.body) {
    const body = typeof obj.body === 'string' ? tryParseJSON(obj.body) ?? obj.body : obj.body
    const inner = extractMessage(body)
    if (inner) return inner
  }

  // Bedrock/LLM-ish shapes
  if (Array.isArray(obj.messages) && obj.messages.length) {
    // try first content-like field
    const first = obj.messages[0]
    if (typeof first?.content === 'string' && first.content.trim()) return first.content
  }

  return null
}
