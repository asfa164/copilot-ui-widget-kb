import React, { useState } from 'react'
import TokenModal from './TokenModal.jsx'
import ChatBox from './ChatBox.jsx'

export default function App() {
  const [verified, setVerified] = useState(false)
  const [token, setToken] = useState('')

  async function verifyToken(inputToken) {
    const res = await fetch('/api/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inputToken })
    })
    const data = await res.json()
    if (res.ok && data.valid) {
      setToken(inputToken)
      setVerified(true)
    } else {
      throw new Error(data?.error || 'Invalid token')
    }
  }

  return (
    <div className="app-shell">
      {!verified
        ? <TokenModal onVerify={verifyToken} />
        : <ChatBox token={token} />}
    </div>
  )
}
