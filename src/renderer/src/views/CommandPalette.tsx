import { useEffect, useMemo, useRef, useState } from 'react'
import type { ConversationMeta } from '../../../shared/types'
import type { View } from '../App'

interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

/**
 * Ctrl/Cmd+K command palette: quick actions (new chat, jump between views,
 * toggle theme) plus type-to-search across existing chats.
 */
export default function CommandPalette({
  onClose,
  onNavigate,
  onNewChat,
  onOpenChat,
  onToggleTheme
}: {
  onClose: () => void
  onNavigate: (view: View) => void
  onNewChat: () => void
  onOpenChat: (id: string) => void
  onToggleTheme: () => void
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [chats, setChats] = useState<ConversationMeta[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    window.api?.conversations.list().then(setChats)
  }, [])

  const actions: Command[] = useMemo(
    () => [
      { id: 'new', label: 'New chat', hint: 'Ctrl+N', run: onNewChat },
      { id: 'go-chats', label: 'Go to Chats', run: () => onNavigate('chats') },
      { id: 'go-projects', label: 'Go to Projects', run: () => onNavigate('projects') },
      { id: 'go-compare', label: 'Go to Compare', run: () => onNavigate('compare') },
      { id: 'go-cowork', label: 'Go to Assistant', run: () => onNavigate('cowork') },
      { id: 'go-forge', label: 'Go to Code', run: () => onNavigate('forge') },
      { id: 'go-studio', label: 'Go to Studio', run: () => onNavigate('studio') },
      { id: 'go-swarm', label: 'Go to Team', run: () => onNavigate('swarm') },
      { id: 'go-providers', label: 'Go to Providers', run: () => onNavigate('providers') },
      { id: 'go-settings', label: 'Go to Settings', run: () => onNavigate('settings') },
      { id: 'theme', label: 'Toggle light / dark theme', run: onToggleTheme }
    ],
    [onNavigate, onNewChat, onToggleTheme]
  )

  const results: Command[] = useMemo(() => {
    const q = query.trim().toLowerCase()
    const acts = q ? actions.filter((a) => a.label.toLowerCase().includes(q)) : actions
    const chatCmds: Command[] = (q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats)
      .slice(0, 8)
      .map((c) => ({ id: `chat-${c.id}`, label: c.title, hint: 'chat', run: () => onOpenChat(c.id) }))
    return [...acts, ...chatCmds]
  }, [query, actions, chats, onOpenChat])

  useEffect(() => {
    setActive(0)
  }, [query])

  const runAt = (i: number) => {
    const cmd = results[i]
    if (cmd) cmd.run()
  }

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command or search chats…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, results.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runAt(active)
            }
          }}
        />
        <div className="palette-list">
          {results.length === 0 && <div className="palette-empty">No matches.</div>}
          {results.map((c, i) => (
            <button
              key={c.id}
              className={`palette-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => runAt(i)}
            >
              <span className="palette-item-label">{c.label}</span>
              {c.hint && <span className="palette-item-hint">{c.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
