// Shared, elegant composer for the section views (Swarm, Cowork, Code, Studio,
// Compare). Matches the landing composer's look (rounded card, inline icon tools,
// round accent send button) and adds real capabilities the old generic boxes
// lacked: file attachments and voice dictation.
//
// Section backends take a plain text task string, so attachments are merged into
// the prompt via `promptWithAttachments` in each view's send handler.
import { useEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '../../../shared/types'
import { AttachIcon, MicIcon, SendIcon, StopIcon, WorkingDots } from './Icons'

/** Fold attached document text (and a note for images) into the outgoing prompt. */
export function promptWithAttachments(text: string, attachments: ChatAttachment[]): string {
  if (!attachments || attachments.length === 0) return text
  const blocks = attachments.map((a) =>
    a.text && a.text.trim()
      ? `--- Attached file: ${a.name} ---\n${a.text.trim()}`
      : `--- Attached: ${a.name} (image — not viewable in this section) ---`
  )
  const joined = blocks.join('\n\n')
  return text ? `${text}\n\n${joined}` : joined
}

export function SectionComposer({
  onSend,
  onStop,
  running = false,
  disabled = false,
  placeholder = 'Type a message… (Enter to send, Shift+Enter for a new line)',
  sendLabel = 'Send',
  rows = 2,
  seed
}: {
  onSend: (text: string, attachments: ChatAttachment[]) => void
  onStop?: () => void
  running?: boolean
  disabled?: boolean
  placeholder?: string
  sendLabel?: string
  rows?: number
  /** Optional starter text (e.g. a clicked example) that pre-fills the box. */
  seed?: string
}) {
  const [text, setText] = useState(seed ?? '')

  // When a starter example is chosen, drop it into the box for the user to send
  // or edit. Only fires when the seed actually changes to something non-empty.
  useEffect(() => {
    if (seed) setText(seed)
  }, [seed])
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  const canSend = (!!text.trim() || attachments.length > 0) && !disabled && !running

  const submit = () => {
    if (!canSend) return
    const t = text.trim()
    setText('')
    const atts = attachments
    setAttachments([])
    onSend(t, atts)
  }

  const attach = async () => {
    const picked = await window.api.chat.pickAttachments()
    if (picked.length > 0) setAttachments((prev) => [...prev, ...picked])
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
  const toggleDictation = () => {
    if (!SpeechRec) {
      alert('Voice dictation is not available in this build.')
      return
    }
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const rec = new SpeechRec()
    rec.lang = navigator.language || 'en-US'
    rec.interimResults = false
    rec.continuous = true
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) chunk += e.results[i][0].transcript
      if (chunk) setText((prev) => (prev ? `${prev} ${chunk}`.replace(/\s+/g, ' ') : chunk))
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    setListening(true)
    rec.start()
  }

  return (
    <div className="scomposer">
      <div className="landing-box">
        {attachments.length > 0 && (
          <div className="attach-chips">
            {attachments.map((a, i) => (
              <span key={i} className="attach-chip">
                {a.image ? '🖼' : '📎'} {a.name}
                <button
                  className="chip-remove"
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          className="landing-textarea"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          rows={rows}
        />
        <div className="landing-bar">
          <div className="landing-tools">
            <button
              className="landing-icon-btn"
              title="Attach documents for context"
              onClick={attach}
              disabled={disabled}
            >
              <AttachIcon />
            </button>
            <button
              className={`landing-icon-btn ${listening ? 'on' : ''}`}
              title="Dictate with your voice"
              onClick={toggleDictation}
              disabled={disabled}
            >
              <MicIcon />
            </button>
          </div>
          {running && <WorkingDots />}
          {running ? (
            <button className="landing-send stop" title="Stop" onClick={onStop}>
              <StopIcon />
            </button>
          ) : (
            <button className="landing-send" title={sendLabel} onClick={submit} disabled={!canSend}>
              <SendIcon />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
