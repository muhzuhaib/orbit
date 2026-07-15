import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import type { ModelInfo, ProviderInfo } from '../../../shared/types'
import { classifyModel, type ModelKind } from '../../../shared/modelCatalog'
import { getFavoriteModels, toggleFavoriteModel } from '../prefs'
import { BoltIcon, BrainIcon, ChevronDownIcon, StarFilledIcon, StarIcon } from './Icons'

/**
 * Searchable model picker. The combined list across every provider is long, so
 * instead of a native <select> this is a popover with a search box, provider
 * groups, and a per-model badge showing whether a model is a "thinking"
 * (reasoning) model or a "fast" one — inferred from the model id.
 */
export default function ModelSelect({
  models,
  value,
  onChange,
  disabled,
  openUp
}: {
  models: ModelInfo[]
  /** `${providerId}/${modelId}` */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  /** open the popover upward (for triggers low on the screen) */
  openUp?: boolean
}) {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState<string[]>(() => getFavoriteModels())
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.providers.list().then(setProviders)
  }, [])

  const toggleFav = (id: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    setFavorites(toggleFavoriteModel(id))
  }

  // Close on outside click / Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const providerLabel = useMemo(() => {
    const map = new Map(providers.map((p) => [p.id, p.label]))
    return (id: string) => (id === 'autopilot' ? '⚡ Smart routing' : (map.get(id) ?? 'Other'))
  }, [providers])

  const current = models.find((m) => m.id === value)
  const currentKind = current ? classifyModel(current.modelId) : 'standard'

  // Grouped + filtered list, preserving provider order from the registry.
  // Favourited models get their own group pinned to the very top.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const order = providers.map((p) => p.id)
    const match = (m: ModelInfo) =>
      !q || m.label.toLowerCase().includes(q) || m.modelId.toLowerCase().includes(q)
    const byProvider = new Map<string, ModelInfo[]>()
    const favModels: ModelInfo[] = []
    for (const m of models) {
      if (!match(m)) continue
      if (favorites.includes(m.id)) favModels.push(m)
      if (!byProvider.has(m.providerId)) byProvider.set(m.providerId, [])
      byProvider.get(m.providerId)!.push(m)
    }
    // 'autopilot' (the smart-routing pseudo-provider) always sorts first.
    const rank = (id: string): number => (id === 'autopilot' ? -1 : order.indexOf(id) + 1 || 999)
    const ids = [...byProvider.keys()].sort((a, b) => rank(a) - rank(b))
    const out = ids.map((id) => ({ id, label: providerLabel(id), models: byProvider.get(id)! }))
    if (favModels.length > 0) {
      // insert favourites after autopilot (if present) so autopilot stays at the very top
      const at = out[0]?.id === 'autopilot' ? 1 : 0
      out.splice(at, 0, { id: '__fav__', label: '★ Favourites', models: favModels })
    }
    return out
  }, [models, providers, query, providerLabel, favorites])

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setQuery('')
  }

  return (
    <div className="model-select" ref={rootRef}>
      <button
        className="ms-trigger"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        title="Choose model"
      >
        <KindBadge kind={currentKind} compact />
        <span className="ms-trigger-label">
          {current ? current.label : value.split('/').slice(1).join('/') || 'Select model'}
        </span>
        <ChevronDownIcon className="icon ms-chevron" />
      </button>

      {open && (
        <div className={`ms-pop ${openUp ? 'ms-pop-up' : ''}`}>
          <input
            ref={searchRef}
            className="ms-search"
            placeholder="Search models…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="ms-list">
            {groups.length === 0 && <div className="ms-empty">No models match “{query}”.</div>}
            {groups.map((g) => (
              <div key={g.id}>
                <div className="ms-group-label">{g.label}</div>
                {g.models.map((m) => {
                  const kind = classifyModel(m.modelId)
                  const fav = favorites.includes(m.id)
                  return (
                    <div
                      key={m.id}
                      className={`ms-option ${m.id === value ? 'selected' : ''}`}
                      onClick={() => pick(m.id)}
                      title={m.modelId}
                    >
                      <button
                        className={`ms-star ${fav ? 'on' : ''}`}
                        title={fav ? 'Remove from favourites' : 'Add to favourites'}
                        onClick={(e) => toggleFav(m.id, e)}
                      >
                        {fav ? <StarFilledIcon /> : <StarIcon />}
                      </button>
                      <span className="ms-option-label">{m.label}</span>
                      {kind !== 'standard' && <KindBadge kind={kind} />}
                      <span className="ms-ctx">{formatContext(m.contextWindow)}</span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="ms-legend">
            <span>
              <BrainIcon className="icon" /> Thinking
            </span>
            <span>
              <BoltIcon className="icon" /> Fast
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function KindBadge({ kind, compact }: { kind: ModelKind; compact?: boolean }) {
  if (kind === 'standard') return compact ? <span style={{ width: 0 }} /> : null
  const Icon = kind === 'thinking' ? BrainIcon : BoltIcon
  return (
    <span className={`ms-kind ${kind}`}>
      <Icon />
      {!compact && (kind === 'thinking' ? 'Thinking' : 'Fast')}
    </span>
  )
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}
