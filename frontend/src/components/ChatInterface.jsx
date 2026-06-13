import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { askQuestion } from '../api'
import './ChatInterface.css'

export default function ChatInterface() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef(null)

  // keep the newest message in view as the conversation grows
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(e) {
    e.preventDefault()
    const question = input.trim()
    if (!question || loading) return

    setInput('')
    setMessages((prev) => [...prev, { role: 'user', text: question }])
    setLoading(true)

    try {
      const { answer, usage } = await askQuestion(question)
      setMessages((prev) => [...prev, { role: 'assistant', text: answer, usage }])
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'error', text: err.message }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="chat-section">
      <div className="chat-history">
        {messages.length === 0 && <div className="chat-empty" />}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message chat-message--${msg.role}`}>
            {/* assistant replies render as markdown (GFM for tables);
                user/error text stays plain so it is never parsed as markup */}
            {msg.role === 'assistant' ? (
              <div className="chat-message__text chat-message__text--md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
              </div>
            ) : (
              <p className="chat-message__text">{msg.text}</p>
            )}
            {msg.usage && (
              <span className="chat-message__usage">
                {msg.usage.input_tokens} in / {msg.usage.output_tokens} out tokens
              </span>
            )}
          </div>
        ))}

        {loading && (
          <div
            className="chat-message chat-message--assistant chat-message--skeleton"
            aria-label="Assistant is thinking"
          >
            <span className="skeleton-line" />
            <span className="skeleton-line" />
            <span className="skeleton-line" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          className="chat-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about the data"
          disabled={loading}
        />
        <button
          className="chat-submit"
          type="submit"
          disabled={loading || !input.trim()}
        />
      </form>
    </section>
  )
}
