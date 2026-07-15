import { useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownView } from './MarkdownView'
import 'highlight.js/styles/github-dark.css'
import type {
  ChatAttachment,
  CompareColumnInput,
  CouncilPanelist,
  ModelInfo
} from '../../../shared/types'
import ModelSelect from './ModelSelect'
import { PlusIcon, TrashIcon, WorkingDots } from './Icons'
import { SectionComposer, promptWithAttachments } from './SectionComposer'
import {
  clearCompareHistory,
  getCompareHistory,
  saveCompareHistory,
  type CompareHistoryEntry
} from '../compareHistory'
import { useBetaFlag } from '../betaFlags'
import { defaultClassifier } from '../autopilot'

interface Column {
  providerId: string
  modelId: string
}
interface CellMeta {
  seconds: number
  tokens: number
}
interface Turn {
  user: string
  answers: string[]
  errors: (string | null)[]
  meta: (CellMeta | null)[]
}

const MAX_COLS = 3

/** Ask the same question to 2–3 models and see their answers side by side. */
export default function CompareView() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [columns, setColumns] = useState<Column[]>([])
  const [turns, setTurns] = useState<Turn[]>([])
  const [streaming, setStreaming] = useState(false)
  const councilOn = useBetaFlag('council')
  const [tab, setTab] = useState<'live' | 'history' | 'council'>('live')
  const [history, setHistory] = useState<CompareHistoryEntry[]>(() => getCompareHistory())
  const runIdRef = useRef<string>('')
  const doneRef = useRef<Set<number>>(new Set())
  const startRef = useRef<number>(0)
  const sessionIdRef = useRef<string>(`s${Date.now().toString(36)}`)

  // Load models + restore the last column setup
  useEffect(() => {
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) => {
      const all = [...m, ...o.models]
      setModels(all)
      const saved = safeParse(localStorage.getItem('orbit-compare-models'))
      const restored = saved.filter((c) => all.some((x) => x.id === `${c.providerId}/${c.modelId}`))
      if (restored.length >= 2) setColumns(restored.slice(0, MAX_COLS))
      else if (all.length > 0)
        setColumns([toCol(all[0]), toCol(all[1] ?? all[0])])
    })
  }, [])

  useEffect(() => {
    if (columns.length > 0) localStorage.setItem('orbit-compare-models', JSON.stringify(columns))
  }, [columns])

  // Live streaming subscriptions
  useEffect(() => {
    const offChunk = window.api.compare.onChunk((e) => {
      if (e.runId !== runIdRef.current) return
      setTurns((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last) return prev
        const answers = [...last.answers]
        answers[e.index] = (answers[e.index] ?? '') + e.delta
        next[next.length - 1] = { ...last, answers }
        return next
      })
    })
    const finish = (index: number, error?: string, tokens?: number) => {
      setTurns((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        if (!last) return prev
        const errors = [...last.errors]
        if (error !== undefined) errors[index] = error
        const meta = [...(last.meta ?? columns.map(() => null))]
        const seconds = startRef.current ? (Date.now() - startRef.current) / 1000 : 0
        const ans = last.answers[index] ?? ''
        // Prefer real usage from the provider; otherwise estimate ~4 chars/token.
        meta[index] = { seconds: Math.max(0.1, seconds), tokens: tokens ?? Math.round(ans.length / 4) }
        next[next.length - 1] = { ...last, errors, meta }
        return next
      })
      doneRef.current.add(index)
      if (doneRef.current.size >= columns.length) setStreaming(false)
    }
    const offDone = window.api.compare.onDone((e) => {
      if (e.runId === runIdRef.current) finish(e.index, undefined, e.usage?.outputTokens)
    })
    const offError = window.api.compare.onError((e) => {
      if (e.runId === runIdRef.current) finish(e.index, e.message)
    })
    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [columns.length])

  // Snapshot the comparison to history whenever a run finishes (keeps last 3).
  useEffect(() => {
    if (streaming || turns.length === 0) return
    const labels = columns.map(
      (c) => models.find((m) => m.id === `${c.providerId}/${c.modelId}`)?.label ?? c.modelId
    )
    setHistory(
      saveCompareHistory({
        id: sessionIdRef.current,
        at: Date.now(),
        models: labels,
        turns: turns.map((t) => ({ user: t.user, answers: t.answers }))
      })
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  const setColumnModel = (i: number, value: string) => {
    const [providerId, ...rest] = value.split('/')
    setColumns((prev) => prev.map((c, j) => (j === i ? { providerId, modelId: rest.join('/') } : c)))
  }
  const addColumn = () => {
    if (columns.length >= MAX_COLS || models.length === 0) return
    setColumns((prev) => [...prev, toCol(models[prev.length] ?? models[0])])
    setTurns((prev) =>
      prev.map((t) => ({ ...t, answers: [...t.answers, ''], errors: [...t.errors, null], meta: [...t.meta, null] }))
    )
  }
  const removeColumn = (i: number) => {
    if (columns.length <= 2) return
    setColumns((prev) => prev.filter((_, j) => j !== i))
    setTurns((prev) =>
      prev.map((t) => ({
        ...t,
        answers: t.answers.filter((_, j) => j !== i),
        errors: t.errors.filter((_, j) => j !== i),
        meta: t.meta.filter((_, j) => j !== i)
      }))
    )
  }

  const send = (raw: string, attachments: ChatAttachment[] = []) => {
    const prompt = promptWithAttachments(raw, attachments).trim()
    if (!prompt || streaming || columns.length === 0) return
    // Build per-column history from the existing turns (before adding this one)
    const inputs: CompareColumnInput[] = columns.map((c, i) => {
      const history: CompareColumnInput['history'] = []
      for (const t of turns) {
        history.push({ role: 'user', content: t.user })
        history.push({ role: 'assistant', content: t.answers[i] ?? '' })
      }
      history.push({ role: 'user', content: prompt })
      return { providerId: c.providerId, modelId: c.modelId, history }
    })
    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    runIdRef.current = runId
    doneRef.current = new Set()
    startRef.current = Date.now()
    setTurns((prev) => [
      ...prev,
      { user: prompt, answers: columns.map(() => ''), errors: columns.map(() => null), meta: columns.map(() => null) }
    ])
    setStreaming(true)
    window.api.compare.run(runId, inputs)
  }

  const stop = () => {
    window.api.compare.stop(runIdRef.current)
    setStreaming(false)
  }
  const clear = () => {
    if (streaming) stop()
    setTurns([])
    sessionIdRef.current = `s${Date.now().toString(36)}` // next comparison is a new history entry
  }

  const gridStyle = useMemo(
    () => ({ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }),
    [columns.length]
  )

  return (
    <div className="compare">
      <div className="compare-head">
        <h1>Compare</h1>
        <div className="compare-tabs">
          <button className={`ghost small ${tab === 'live' ? 'tab-active' : ''}`} onClick={() => setTab('live')}>
            Live
          </button>
          <button
            className={`ghost small ${tab === 'history' ? 'tab-active' : ''}`}
            onClick={() => setTab('history')}
          >
            History ({history.length})
          </button>
          {councilOn && (
            <button
              className={`ghost small ${tab === 'council' ? 'tab-active' : ''}`}
              onClick={() => setTab('council')}
              title="Council: 2–3 models answer, then a judge writes a verdict"
            >
              Council
            </button>
          )}
        </div>
        <div className="row" style={{ margin: 0, width: 'auto' }}>
          {tab === 'live' && columns.length < MAX_COLS && (
            <button className="ghost small icon-btn" onClick={addColumn}>
              <PlusIcon /> Add model
            </button>
          )}
          {tab === 'live' && turns.length > 0 && (
            <button className="ghost small icon-btn danger" onClick={clear}>
              <TrashIcon /> Clear
            </button>
          )}
          {tab === 'history' && history.length > 0 && (
            <button
              className="ghost small icon-btn danger"
              onClick={() => {
                clearCompareHistory()
                setHistory([])
              }}
            >
              <TrashIcon /> Clear history
            </button>
          )}
        </div>
      </div>

      {tab === 'history' && <CompareHistoryView history={history} />}

      {tab === 'council' && <CouncilPanel models={models} />}

      {tab === 'live' && (
        <>
      <div className="compare-cols-header" style={gridStyle}>
        {columns.map((c, i) => (
          <div key={i} className="compare-col-head">
            <ModelSelect
              models={models}
              value={`${c.providerId}/${c.modelId}`}
              onChange={(v) => setColumnModel(i, v)}
              disabled={streaming}
            />
            {columns.length > 2 && (
              <button className="ghost small" title="Remove this model" onClick={() => removeColumn(i)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="compare-turns">
        {turns.length === 0 ? (
          <div className="placeholder">
            <h1>Compare models</h1>
            <p>Pick 2 models above (add a 3rd with “+ Add model”), then ask one question to see their answers side by side.</p>
          </div>
        ) : (
          turns.map((turn, ti) => (
            <div key={ti} className="compare-turn">
              <div className="compare-user">
                <div className="msg-bubble">{turn.user}</div>
              </div>
              <div className="compare-answer-row" style={gridStyle}>
                {columns.map((_, i) => (
                  <div key={i} className="compare-cell markdown">
                    {turn.errors[i] ? (
                      <div className="compare-cell-error">⚠ {turn.errors[i]}</div>
                    ) : turn.answers[i] ? (
                      <>
                        <MarkdownView>
                          {turn.answers[i]}
                        </MarkdownView>
                        {turn.meta[i] && (
                          <div className="compare-cell-meta">
                            <span>
                              {turn.meta[i]!.seconds.toFixed(1)}s · ~{turn.meta[i]!.tokens} tok
                            </span>
                            <button
                              className="ghost small"
                              onClick={() => navigator.clipboard.writeText(turn.answers[i])}
                            >
                              Copy
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="thinking-dots">…</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      <SectionComposer
        running={streaming}
        disabled={columns.length === 0}
        onSend={send}
        onStop={stop}
        placeholder="Ask all the models the same thing… (Enter to send, Shift+Enter for a new line)"
        sendLabel={`Send to ${columns.length} model${columns.length === 1 ? '' : 's'}`}
        rows={2}
      />
        </>
      )}
    </div>
  )
}

/** Read-only view of recent comparisons (last 3). */
function CompareHistoryView({ history }: { history: CompareHistoryEntry[] }) {
  if (history.length === 0) {
    return (
      <div className="placeholder">
        <h1>No comparisons yet</h1>
        <p>Run a comparison on the Live tab — your last 3 will appear here.</p>
      </div>
    )
  }
  return (
    <div className="compare-history">
      {history.map((h) => (
        <div key={h.id} className="compare-history-entry">
          <div className="compare-history-head">
            <span className="compare-history-models">{h.models.join('  vs  ')}</span>
            <span className="compare-history-date">{new Date(h.at).toLocaleString()}</span>
          </div>
          {h.turns.map((t, ti) => (
            <div key={ti} className="compare-turn">
              <div className="compare-user">
                <div className="msg-bubble">{t.user}</div>
              </div>
              <div
                className="compare-answer-row"
                style={{ gridTemplateColumns: `repeat(${h.models.length}, minmax(0, 1fr))` }}
              >
                {t.answers.map((a, i) => (
                  <div key={i} className="compare-cell markdown">
                    <MarkdownView>
                      {a || '_(no answer)_'}
                    </MarkdownView>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Council mode (beta): send one prompt to 2–3 models, then a judge model writes a
 * verdict (agreements, contradictions, final synthesised answer). Reuses the same
 * streaming approach as Compare; nothing is written to chat storage.
 */
const MAX_PANEL = 3
function CouncilPanel({ models }: { models: ModelInfo[] }) {
  const [panel, setPanel] = useState<Column[]>([])
  const [judge, setJudge] = useState<Column | null>(null)
  const [answers, setAnswers] = useState<string[]>([])
  const [answerErrors, setAnswerErrors] = useState<(string | null)[]>([])
  const [verdict, setVerdict] = useState('')
  const [status, setStatus] = useState('')
  const [running, setRunning] = useState(false)
  const [asked, setAsked] = useState('')
  const runIdRef = useRef('')
  const doneRef = useRef(0)

  // Defaults: first 2 models as panelists, a cheap model as judge.
  useEffect(() => {
    if (models.length === 0) return
    setPanel((p) => (p.length >= 2 ? p : [toCol(models[0]), toCol(models[1] ?? models[0])]))
    setJudge((j) => j ?? toCol(defaultClassifier(models) ?? models[0]))
  }, [models])

  useEffect(() => {
    const offA = window.api.council.onAnswerChunk((e) => {
      if (e.runId !== runIdRef.current) return
      setAnswers((prev) => {
        const next = [...prev]
        next[e.index] = (next[e.index] ?? '') + e.delta
        return next
      })
    })
    const offAD = window.api.council.onAnswerDone((e) => {
      if (e.runId !== runIdRef.current) return
      if (e.error) setAnswerErrors((prev) => prev.map((x, i) => (i === e.index ? e.error! : x)))
    })
    const offV = window.api.council.onVerdictChunk((e) => {
      if (e.runId === runIdRef.current) setVerdict((v) => v + e.delta)
    })
    const offS = window.api.council.onStatus((e) => {
      if (e.runId === runIdRef.current) setStatus(e.text)
    })
    const offD = window.api.council.onDone((e) => {
      if (e.runId === runIdRef.current) {
        setRunning(false)
        setStatus('')
      }
    })
    const offE = window.api.council.onError((e) => {
      if (e.runId === runIdRef.current) {
        setRunning(false)
        setStatus('')
        setVerdict((v) => v || `⚠ ${e.message}`)
      }
    })
    return () => {
      offA()
      offAD()
      offV()
      offS()
      offD()
      offE()
    }
  }, [])

  const label = (c: Column): string =>
    models.find((m) => m.id === `${c.providerId}/${c.modelId}`)?.label ?? c.modelId

  const setPanelModel = (i: number, value: string): void => {
    const [providerId, ...rest] = value.split('/')
    setPanel((prev) => prev.map((c, j) => (j === i ? { providerId, modelId: rest.join('/') } : c)))
  }
  const addPanelist = (): void => {
    if (panel.length >= MAX_PANEL || models.length === 0) return
    setPanel((prev) => [...prev, toCol(models[prev.length] ?? models[0])])
  }
  const removePanelist = (i: number): void => {
    if (panel.length <= 2) return
    setPanel((prev) => prev.filter((_, j) => j !== i))
  }

  const send = (raw: string, attachments: ChatAttachment[] = []): void => {
    const prompt = promptWithAttachments(raw, attachments).trim()
    if (!prompt || running || panel.length < 2 || !judge) return
    const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
    runIdRef.current = runId
    doneRef.current = 0
    setAsked(prompt)
    setAnswers(panel.map(() => ''))
    setAnswerErrors(panel.map(() => null))
    setVerdict('')
    setStatus('Council members are answering…')
    setRunning(true)
    const panelists: CouncilPanelist[] = panel.map((c) => ({
      providerId: c.providerId,
      modelId: c.modelId,
      label: label(c)
    }))
    window.api.council.run(runId, { prompt, panelists, judge: { ...judge } })
  }
  const stop = (): void => {
    window.api.council.stop(runIdRef.current)
    setRunning(false)
    setStatus('')
  }

  const hasResults = asked !== ''

  return (
    <div className="council">
      <div className="council-setup">
        <div className="council-field">
          <span className="council-label">⚖ Judge</span>
          <ModelSelect
            models={models}
            value={judge ? `${judge.providerId}/${judge.modelId}` : ''}
            onChange={(v) => {
              const [providerId, ...rest] = v.split('/')
              setJudge({ providerId, modelId: rest.join('/') })
            }}
            disabled={running}
          />
        </div>
        <div className="council-field council-panelists">
          <span className="council-label">👥 Council</span>
          {panel.map((c, i) => (
            <div key={i} className="council-panelist">
              <ModelSelect
                models={models}
                value={`${c.providerId}/${c.modelId}`}
                onChange={(v) => setPanelModel(i, v)}
                disabled={running}
              />
              {panel.length > 2 && (
                <button className="ghost small" title="Remove" disabled={running} onClick={() => removePanelist(i)}>
                  ✕
                </button>
              )}
            </div>
          ))}
          {panel.length < MAX_PANEL && (
            <button className="ghost small icon-btn" onClick={addPanelist} disabled={running}>
              <PlusIcon /> Add
            </button>
          )}
        </div>
      </div>

      <div className="council-body chat-messages">
        {!hasResults ? (
          <div className="cowork-hint">
            Pick 2–3 models for the <strong>Council</strong> and a <strong>Judge</strong>, then ask a
            question. Each council model answers, then the judge tells you where they agree, where
            they disagree, and gives a final combined answer.
          </div>
        ) : (
          <>
            <div className="msg msg-user">
              <div className="msg-bubble">{asked}</div>
            </div>
            <div className="council-verdict">
              <div className="council-verdict-label">⚖ Verdict</div>
              <div className="msg-body markdown">
                {verdict ? (
                  <MarkdownView>
                    {verdict}
                  </MarkdownView>
                ) : (
                  <WorkingDots label={status || 'Working…'} />
                )}
              </div>
            </div>
            <details className="council-answers" open={!verdict}>
              <summary>Individual answers ({panel.length})</summary>
              {panel.map((c, i) => (
                <div key={i} className="council-answer">
                  <div className="council-answer-head">{label(c)}</div>
                  <div className="markdown">
                    {answerErrors[i] ? (
                      <div className="compare-cell-error">⚠ {answerErrors[i]}</div>
                    ) : answers[i] ? (
                      <MarkdownView>
                        {answers[i]}
                      </MarkdownView>
                    ) : (
                      <WorkingDots label="Working…" />
                    )}
                  </div>
                </div>
              ))}
            </details>
          </>
        )}
      </div>

      <SectionComposer
        running={running}
        disabled={panel.length < 2 || !judge}
        onSend={send}
        onStop={stop}
        placeholder="Ask the council one question… (Enter to start, Shift+Enter for a new line)"
        sendLabel="Convene council"
        rows={2}
      />
    </div>
  )
}

const toCol = (m: ModelInfo): Column => ({ providerId: m.providerId, modelId: m.modelId })

function safeParse(raw: string | null): Column[] {
  try {
    const v = raw ? JSON.parse(raw) : []
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
