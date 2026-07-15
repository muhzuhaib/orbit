// Live "what the agent is doing right now" status bar for Cowork / Code.
// Shows a ticking elapsed timer, a running token total, and the current activity
// (Thinking… / Writing… / Running <tool>…) — so the user can watch progress
// instead of staring at a frozen screen. Purely a live indicator; nothing here
// is persisted or part of the model's output.
import { useEffect, useState } from 'react'
import { WorkingDots } from './Icons'

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export function formatElapsed(ms: number): string {
  const secs = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function AgentStatusBar({
  startedAt,
  tokens,
  activity,
  detail
}: {
  startedAt: number
  tokens: number
  activity: string
  detail?: string
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="agent-status">
      <span className="agent-status-spark" aria-hidden>
        ✳
      </span>
      <span className="agent-status-time">{formatElapsed(now - startedAt)}</span>
      {tokens > 0 && (
        <>
          <span className="agent-status-sep">·</span>
          <span className="agent-status-tokens">{formatTokens(tokens)} tokens</span>
        </>
      )}
      <span className="agent-status-sep">·</span>
      <span className="agent-status-activity">{activity}</span>
      {detail && <span className="agent-status-detail">{detail}</span>}
      <WorkingDots />
    </div>
  )
}
