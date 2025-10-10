import React, { useState } from 'react'

export default function TokenModal({ onVerify }) {
  const [token, setToken] = useState('')
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (!token.trim()) { setError('Please enter your API token.'); return }
    try {
      await onVerify(token.trim())
    } catch (err) {
      setError('❌ ' + err.message)
      return
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="token-title">
      <form className="modal-card" onSubmit={submit}>
        <h3 id="token-title">Enter API Token</h3>
        <p className="small">Your token is validated on the server. It is not stored in the browser.</p>
        <input
          type="password"
          placeholder="Enter your token"
          value={token}
          onChange={e => setToken(e.target.value)}
          autoFocus
        />
        <button type="submit">Verify</button>
        <div className="error" aria-live="polite">{error}</div>
      </form>
    </div>
  )
}
