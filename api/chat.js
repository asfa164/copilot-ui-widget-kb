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
      return res.status(500).json({ error: 'Server not configured' })
    }
    // Verify token again server-side
    if (!token || token !== expected) {
      return res.status(401).json({ error: 'Unauthorized' })
    }

    // Compose payload for upstream
    const payload = {
      query,
      sessionAttributes: {
        auth_token: token,
        product: 'voice_assure',
        request_source: 'ui'
      }
    }

    // Proxy the request, hiding URL and secret from client
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${expected}` },
      body: JSON.stringify(payload)
    })

    const text = await upstreamRes.text()
    let data
    try { data = JSON.parse(text) } catch { data = { message: text } }

    // Normalize common shapes
    let body = data?.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch { body = { message: body } }
    }
    const normalized = body || data || {}
    const message = normalized?.message || normalized?.messageText || 'No message found.'

    return res.status(200).json({ message })
  } catch (e) {
    return res.status(500).json({ error: 'Proxy error', details: e?.message })
  }
}
