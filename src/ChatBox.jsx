import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function ChatBox({ token }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')

  async function sendMessage() {
    if (!input.trim()) return
    setMessages(prev => [...prev, { sender: 'You', text: input }, { sender: 'Copilot', text: 'Typing...' }])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input, token })
      })

      const data = await res.json()
      const reply = data?.message ?? 'No message found.'

      setMessages(prev => [...prev.slice(0, -1), { sender: 'Copilot', text: reply }])
    } catch (err) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { sender: 'Copilot', text: '⚠️ Error: ' + err.message }
      ])
    }

    setInput('')
  }

  return (
    <div>
      <div className="header">
        <h2>Cyara Copilot — External KB</h2>
      </div>

      <div className="chat-box" id="chat">
        {messages.map((m, i) => (
          <div key={i} className={['msg', m.sender.toLowerCase()].join(' ')}>
            <strong>{m.sender}:</strong>
            <div className="msg-text">
              {m.sender === 'Copilot'
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                : <span>{m.text}</span>}
            </div>
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
