export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST'])
    return res.status(405).json({ error: 'Method Not Allowed' })
  }
  try {
    const { token } = req.body || {}
    const expected = process.env.API_TOKEN
    if (!expected) {
      return res.status(500).json({ valid: false, error: 'Server not configured' })
    }
    if (token && token === expected) {
      return res.status(200).json({ valid: true })
    }
    return res.status(401).json({ valid: false, error: 'Invalid token' })
  } catch (e) {
    return res.status(500).json({ valid: false, error: 'Verification failed' })
  }
}
