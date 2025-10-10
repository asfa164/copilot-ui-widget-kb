// src/ChatBox.jsx
import React, { useState } from 'react'

export default function ChatBox({ token }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')

  async function sendMessage() {
    if (!input.trim()) return

    // Show "Typing..." placeholder
    setMessages(prev => [...prev, { sender: 'You', text: input }, { sender: 'Copilot', text: 'Typing...', raw: null }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input, token })
      })

      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = { message: text } }

      // We now expect { message, raw } from the proxy
      const reply = data?.message ?? 'No message found.'
      const raw = data?.raw ?? data

      setMessages(prev => [
        ...prev.slice(0, -1),
        { sender: 'Copilot', text: reply, raw }
      ])
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { sender: 'Copilot', text: '⚠️ Error: ' + err.message, raw: null }
      ])
    }

    setInput('')
  }

  return (
    <div>
      <div className="header">
        <h2>Cyara Copilot — External KB</h2>
        {/* No "Change Token" button by request */}
      </div>

      <div className="chat-box" id="chat">
        {messages.map((m, i) => (
          <div key={i} className={['msg', m.sender.toLowerCase()].join(' ')}>
            <strong>{m.sender}:</strong> <span>{m.text}</span>
            {m.sender === 'Copilot' && m.raw && (
              <details style={{ marginTop: '6px', background:'#f8f9fa', borderRadius:'6px', padding:'6px' }}>
                <summary style={{ cursor: 'pointer', color:'#444', fontSize:'13px' }}>Full JSON Response</summary>
                <pre style={{ fontSize:'12px', overflowX:'auto', whiteSpace:'pre-wrap' }}>
                  {JSON.stringify(m.raw, null, 2)}
                </pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="input-row">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask something..."
          onKeyDown={e => e.key === 'Enter' && sendMessage()}
        />
        <button onClick={sendMessage}>Send</button>
      </div>
    </div>
  )
}
