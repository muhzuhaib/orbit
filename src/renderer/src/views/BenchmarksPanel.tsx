import { useEffect, useMemo, useRef, useState } from 'react'
import type { BenchmarkData, BenchmarkModel, BenchmarkRun, ModelInfo } from '../../../shared/types'
import { formatCost } from '../../../shared/modelPricing'
import { defaultClassifier } from '../autopilot'
import { WorkingDots } from './Icons'

// Personal benchmarks (beta): save your own prompts, run them across chosen
// models, and let a judge score each answer 1–10. All storage is a new file
// (benchmarks.json) — nothing existing is touched.

const MAX_PROMPTS = 10
const KNOWN_KEY = 'orbit-benchmark-known-models'

export default function BenchmarksPanel() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [data, setData] = useState<BenchmarkData>({ prompts: [], history: [] })
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [judgeId, setJudgeId] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState('')
  const [lastRun, setLastRun] = useState<BenchmarkRun | null>(null)
  const [newModels, setNewModels] = useState<string[]>([])
  const runIdRef = useRef('')

  useEffect(() => {
    window.api.benchmarks.get().then((d) => {
      setData(d)
      setLastRun(d.history[0] ?? null)
    })
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) => {
      const all = [...m, ...o.models]
      setModels(all)
      // Default selection: the first few models; judge = a cheap model.
      setSelected((s) => (s.size ? s : new Set(all.slice(0, 3).map((x) => x.id))))
      setJudgeId((j) => j || defaultClassifier(all)?.id || all[0]?.id || '')
      // New-model detection (never auto-runs — just a notice).
      try {
        const known: string[] = JSON.parse(localStorage.getItem(KNOWN_KEY) ?? 'null') ?? []
        if (known.length) {
          const fresh = all.map((x) => x.id).filter((id) => !known.includes(id))
          if (fresh.length) setNewModels(fresh)
        } else {
          localStorage.setItem(KNOWN_KEY, JSON.stringify(all.map((x) => x.id)))
        }
      } catch {
        // ignore
      }
    })
  }, [])

  useEffect(() => {
    const offP = window.api.benchmarks.onProgress((e) => {
      if (e.runId === runIdRef.current) setProgress(e.text)
    })
    const offD = window.api.benchmarks.onDone((e) => {
      if (e.runId !== runIdRef.current) return
      setRunning(false)
      setProgress('')
      if (e.run) {
        setLastRun(e.run)
        setData((d) => ({ ...d, history: [e.run!, ...d.history].slice(0, 20) }))
        localStorage.setItem(KNOWN_KEY, JSON.stringify(models.map((x) => x.id)))
        setNewModels([])
      }
    })
    const offE = window.api.benchmarks.onError((e) => {
      if (e.runId !== runIdRef.current) return
      setRunning(false)
      setProgress(`⚠ ${e.message}`)
    })
    return () => {
      offP()
      offD()
      offE()
    }
  }, [models])

  const addPrompt = (): void => {
    const text = draft.trim()
    if (!text || data.prompts.length >= MAX_PROMPTS) return
    const prompts = [...data.prompts, { id: `p${Date.now().toString(36)}`, text }]
    window.api.benchmarks.savePrompts(prompts).then(setData)
    setDraft('')
  }
  const removePrompt = (id: string): void => {
    const prompts = data.prompts.filter((p) => p.id !== id)
    window.api.benchmarks.savePrompts(prompts).then(setData)
  }
  const toggleModel = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toModel = (id: string): BenchmarkModel | null => {
    const m = models.find((x) => x.id === id)
    if (!m) return null
    return { providerId: m.providerId, modelId: m.modelId, label: m.label }
  }

  const run = (): void => {
    const chosen = [...selected].map(toModel).filter(Boolean) as BenchmarkModel[]
    const judge = toModel(judgeId)
    if (running || data.prompts.length === 0 || chosen.length === 0 || !judge) return
    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    runIdRef.current = runId
    setRunning(true)
    setProgress('Starting…')
    setLastRun(null)
    window.api.benchmarks.run(runId, { prompts: data.prompts, models: chosen, judge })
  }
  const stop = (): void => {
    window.api.benchmarks.stop(runIdRef.current)
    setRunning(false)
    setProgress('')
  }

  const canRun = data.prompts.length > 0 && selected.size > 0 && judgeId && !running

  return (
    <div className="benchmarks-panel">
      {newModels.length > 0 && (
        <div className="benchmark-notice">
          ✨ {newModels.length} new model{newModels.length > 1 ? 's' : ''} detected since your last run
          — run your benchmark to see how {newModels.length > 1 ? 'they' : 'it'} compare
          {newModels.length > 1 ? '' : 's'}?
          <button className="ghost small" onClick={() => setNewModels([])}>
            Dismiss
          </button>
        </div>
      )}

      <div className="benchmark-sub">Your test prompts ({data.prompts.length}/{MAX_PROMPTS})</div>
      <ul className="benchmark-prompts">
        {data.prompts.map((p) => (
          <li key={p.id}>
            <span>{p.text}</span>
            <button className="ghost small" onClick={() => removePrompt(p.id)} disabled={running}>
              ✕
            </button>
          </li>
        ))}
        {data.prompts.length === 0 && <li className="benchmark-empty">No prompts yet — add one below.</li>}
      </ul>
      {data.prompts.length < MAX_PROMPTS && (
        <div className="benchmark-add">
          <input
            value={draft}
            placeholder="Add a test prompt (e.g. “Explain recursion to a 10-year-old”)…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPrompt()}
            disabled={running}
          />
          <button className="ghost small" onClick={addPrompt} disabled={running || !draft.trim()}>
            Add
          </button>
        </div>
      )}

      <div className="benchmark-sub">Models to test</div>
      <div className="benchmark-models">
        {models.map((m) => (
          <label key={m.id} className="benchmark-model">
            <input
              type="checkbox"
              checked={selected.has(m.id)}
              onChange={() => toggleModel(m.id)}
              disabled={running}
            />
            {m.label}
          </label>
        ))}
      </div>

      <div className="row" style={{ marginTop: 8 }}>
        <label className="field-label">Judge model</label>
        <select value={judgeId} onChange={(e) => setJudgeId(e.target.value)} disabled={running}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div className="benchmark-run-row">
        {running ? (
          <button className="icon-btn" onClick={stop}>
            Stop
          </button>
        ) : (
          <button className="icon-btn" onClick={run} disabled={!canRun}>
            Run benchmark
          </button>
        )}
        {running && <WorkingDots label={progress || 'Running…'} />}
        {!running && progress && <span className="benchmark-progress">{progress}</span>}
      </div>

      {lastRun && <BenchmarkResults run={lastRun} />}

      {data.history.length > 1 && (
        <details className="benchmark-history">
          <summary>Past runs ({data.history.length})</summary>
          {data.history.map((r) => (
            <div key={r.id} className="benchmark-history-item">
              <div className="benchmark-history-head">
                {new Date(r.at).toLocaleString()} · judge: {r.judgeModel}
              </div>
              <BenchmarkResults run={r} compact />
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

/** Averaged leaderboard for one run: score, speed, cost per model. */
function BenchmarkResults({ run, compact }: { run: BenchmarkRun; compact?: boolean }) {
  const rows = useMemo(() => {
    const byModel = new Map<
      string,
      { label: string; score: number; seconds: number; cost: number; costKnown: boolean; n: number }
    >()
    for (const r of run.results) {
      const cur = byModel.get(r.model) ?? {
        label: r.modelLabel,
        score: 0,
        seconds: 0,
        cost: 0,
        costKnown: true,
        n: 0
      }
      cur.score += r.score
      cur.seconds += r.seconds
      if (r.cost == null) cur.costKnown = false
      else cur.cost += r.cost
      cur.n += 1
      byModel.set(r.model, cur)
    }
    return [...byModel.values()]
      .map((v) => ({
        label: v.label,
        avgScore: v.n ? v.score / v.n : 0,
        avgSeconds: v.n ? v.seconds / v.n : 0,
        cost: v.cost,
        costKnown: v.costKnown
      }))
      .sort((a, b) => b.avgScore - a.avgScore)
  }, [run])

  return (
    <table className="benchmark-table">
      <thead>
        <tr>
          <th>Model</th>
          <th>Avg score</th>
          <th>Avg speed</th>
          {!compact && <th>Total cost</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.label + i}>
            <td>{i === 0 ? '🏆 ' : ''}{r.label}</td>
            <td>
              <strong>{r.avgScore.toFixed(1)}</strong>/10
            </td>
            <td>{r.avgSeconds.toFixed(1)}s</td>
            {!compact && <td>{r.costKnown ? formatCost(r.cost) : '—'}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
