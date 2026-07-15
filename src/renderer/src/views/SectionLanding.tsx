import type { ReactNode } from 'react'
import { PlusIcon } from './Icons'

// A shared, elegant "home" screen for the session-based sections (Code, Cowork,
// Studio, Swarm) and Projects. Each section passes its own icon, copy, stats,
// recent items and steps so the landing fits that section's purpose.

export interface LandingStat {
  label: string
  value: string | number
}
export interface LandingRecent {
  id: string
  title: string
  subtitle?: string
}

export default function SectionLanding({
  icon,
  title,
  subtitle,
  stats,
  ctaLabel,
  onCta,
  ctaDisabled,
  note,
  recent,
  onOpen,
  steps,
  examples,
  onExample
}: {
  icon: ReactNode
  title: string
  subtitle: string
  stats: LandingStat[]
  ctaLabel?: string
  onCta?: () => void
  ctaDisabled?: boolean
  note?: string
  recent?: LandingRecent[]
  onOpen?: (id: string) => void
  steps?: string[]
  /** Starter prompts shown as clickable chips (great for a friendly first run). */
  examples?: string[]
  onExample?: (prompt: string) => void
}) {
  return (
    <div className="section-landing">
      <div className="section-landing-inner">
        <div className="section-hero">
          <span className="section-hero-icon">{icon}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>

        {stats.length > 0 && (
          <div
            className="section-stats"
            style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}
          >
            {stats.map((s, i) => (
              <div key={i} className="section-stat">
                <div className="section-stat-label">{s.label}</div>
                <div className="section-stat-value">{s.value}</div>
              </div>
            ))}
          </div>
        )}

        {ctaLabel && onCta && (
          <button className="section-cta" onClick={onCta} disabled={ctaDisabled}>
            <PlusIcon /> {ctaLabel}
          </button>
        )}
        {note && <p className="section-landing-note">{note}</p>}

        {examples && examples.length > 0 && onExample && (
          <div className="section-examples">
            <div className="section-examples-label">Try one of these</div>
            <div className="section-examples-chips">
              {examples.map((ex, i) => (
                <button
                  key={i}
                  className="section-example-chip"
                  onClick={() => onExample(ex)}
                  disabled={ctaDisabled}
                  title={ctaDisabled ? 'Add an API key in Providers to begin' : 'Start with this'}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {recent && recent.length > 0 && onOpen && (
          <div className="section-recent">
            <div className="section-recent-label">Recent</div>
            {recent.map((r) => (
              <button key={r.id} className="section-recent-item" onClick={() => onOpen(r.id)}>
                <span className="section-recent-title">{r.title}</span>
                {r.subtitle && <span className="section-recent-sub">{r.subtitle}</span>}
              </button>
            ))}
          </div>
        )}

        {steps && steps.length > 0 && (
          <div className="section-steps">
            {steps.map((s, i) => (
              <span key={i}>
                {i + 1} · {s}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Compact "n minutes ago" helper shared by the section landings. */
export function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
