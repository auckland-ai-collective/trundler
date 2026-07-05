import { useState, type KeyboardEvent } from 'react'

interface Props {
  running: boolean
  onSend: (text: string) => void
  onCancel: () => void
}

export function Composer({ running, onSend, onCancel }: Props): JSX.Element {
  const [text, setText] = useState('')

  function submit(): void {
    const trimmed = text.trim()
    if (!trimmed || running) return
    onSend(trimmed)
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder="Ask about products, prices, specials, or your cart…  (Enter to send, Shift+Enter for newline)"
        value={text}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {running ? (
        <button className="stop-btn" onClick={onCancel}>
          Stop
        </button>
      ) : (
        <button className="send-btn" onClick={submit} disabled={!text.trim()}>
          Send
        </button>
      )}
    </div>
  )
}
