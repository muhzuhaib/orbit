import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownView } from './MarkdownView'
import 'highlight.js/styles/github-dark.css'
import type {
  ChatAttachment,
  ModelInfo,
  SwarmSession,
  SwarmSessionMeta,
  SwarmSubtask
} from '../../../shared/types'
import ModelSelect from './ModelSelect'
import { PlusIcon, SwarmIcon, WorkingDots } from './Icons'
import SectionLanding, { timeAgo } from './SectionLanding'
import { SectionComposer, promptWithAttachments } from './SectionComposer'

// A normalised subtask shape shared by the live run and persisted turns.
interface LiveSub {
  id: string
  model: string
  title: string
  output: string
  status: SwarmSubtask['status']
  error?: string
}
interface LiveTurn {
  task: string
  statusLine: string
  subtasks: LiveSub[]
  synthesis: string
}

export default function SwarmView({ collapsed }: { collapsed?: boolean }) {
  const [metas, setMetas] = useState<SwarmSessionMeta[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [session, setSession] = useState<SwarmSession | null>(null)
  const [live, setLive] = useState<LiveTurn | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exampleSeed, setExampleSeed] = useState('')
  const sessionRef = useRef<SwarmSession | null>(null)
  sessionRef.current = session

  const refreshMetas = useCallback(async () => {
    setMetas(await window.api.swarm.list())
  }, [])

  useEffect(() => {
    refreshMetas()
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) =>
      setModels([...m, ...o.models])
    )
  }, [refreshMetas])

  useEffect(() => {
    const off = window.api.swarm.onEvent(({ sessionId, ev }) => {
      if (sessionId !== sessionRef.current?.id) return
      if (ev.type === 'status') {
        setLive((l) => (l ? { ...l, statusLine: ev.text } : l))
      } else if (ev.type === 'plan') {
        setLive((l) =>
          l
            ? {
                ...l,
                statusLine: '',
                subtasks: ev.subtasks.map((s) => ({
                  id: s.id,
                  model: s.model,
                  title: s.title,
                  output: '',
                  status: 'running'
                }))
              }
            : l
        )
      } else if (ev.type === 'worker-chunk') {
        setLive((l) =>
          l
            ? {
                ...l,
                subtasks: l.subtasks.map((s) =>
                  s.id === ev.subtaskId ? { ...s, output: s.output + ev.delta } : s
                )
              }
            : l
        )
      } else if (ev.type === 'worker-done') {
        setLive((l) =>
          l
            ? { ...l, subtasks: l.subtasks.map((s) => (s.id === ev.subtaskId ? { ...s, status: 'done' } : s)) }
            : l
        )
      } else if (ev.type === 'worker-error') {
        setLive((l) =>
          l
            ? {
                ...l,
                subtasks: l.subtasks.map((s) =>
                  s.id === ev.subtaskId ? { ...s, status: 'error', error: ev.message } : s
                )
              }
            : l
        )
      } else if (ev.type === 'synthesis-chunk') {
        setLive((l) => (l ? { ...l, synthesis: l.synthesis + ev.delta } : l))
      } else if (ev.type === 'done' || ev.type === 'error') {
        if (ev.type === 'error') setError(ev.message)
        window.api.swarm.get(sessionId).then((s) => {
          setSession(s)
          setLive(null)
        })
        refreshMetas()
      }
    })
    return off
  }, [refreshMetas])

  const defaultModel = useMemo(() => models[0], [models])

  const newSession = async () => {
    if (!defaultModel) return
    setExampleSeed('')
    const s = await window.api.swarm.create(defaultModel.providerId, defaultModel.modelId)
    setSession(s)
    setError(null)
    setLive(null)
    refreshMetas()
  }

  // Start a new team task pre-filled with an example (friendly first run).
  const startExample = async (prompt: string) => {
    await newSession()
    setExampleSeed(prompt)
  }

  const select = async (id: string) => {
    setSession(await window.api.swarm.get(id))
    setError(null)
    setLive(null)
  }

  const remove = async (id: string) => {
    await window.api.swarm.delete(id)
    if (session?.id === id) setSession(null)
    refreshMetas()
  }

  const setManager = async (value: string) => {
    if (!session) return
    const [providerId, ...rest] = value.split('/')
    setSession(
      await window.api.swarm.update(session.id, { managerProviderId: providerId, managerModelId: rest.join('/') })
    )
  }
  const setWorker = async (i: number, value: string) => {
    if (!session) return
    const [providerId, ...rest] = value.split('/')
    const workers = session.workers.map((w, j) =>
      j === i ? { ...w, providerId, modelId: rest.join('/') } : w
    )
    setSession(await window.api.swarm.update(session.id, { workers }))
  }
  const addWorker = async () => {
    if (!session || !defaultModel) return
    const workers = [
      ...session.workers,
      { id: `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, providerId: defaultModel.providerId, modelId: defaultModel.modelId }
    ]
    setSession(await window.api.swarm.update(session.id, { workers }))
  }
  const removeWorker = async (i: number) => {
    if (!session || session.workers.length <= 1) return
    const workers = session.workers.filter((_, j) => j !== i)
    setSession(await window.api.swarm.update(session.id, { workers }))
  }

  const run = (text: string, attachments: ChatAttachment[] = []) => {
    if (!session) return
    const task = promptWithAttachments(text, attachments)
    setError(null)
    setLive({ task, statusLine: 'Starting…', subtasks: [], synthesis: '' })
    window.api.swarm.run(session.id, task)
  }
  const stop = () => session && window.api.swarm.stop(session.id)

  const running = live !== null

  return (
    <div className="chats">
      <div className={`chat-list ${collapsed ? 'collapsed' : ''}`}>
        <button className="new-chat icon-btn" onClick={newSession} disabled={!defaultModel}>
          <PlusIcon /> New team
        </button>
        {metas.map((m) => (
          <div
            key={m.id}
            className={`chat-item ${session?.id === m.id ? 'active' : ''}`}
            onClick={() => select(m.id)}
          >
            <span className="chat-item-title">{m.title}</span>
            <button
              className="ghost small chat-item-del"
              onClick={(e) => {
                e.stopPropagation()
                remove(m.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {!session ? (
        <SectionLanding
          icon={<SwarmIcon />}
          title="Assemble your team"
          subtitle="A lead model plans a task, delegates the pieces to several worker models running in parallel, then combines their results — teamwork across providers, for faster answers."
          stats={[
            { label: 'Teams', value: metas.length },
            { label: 'Last active', value: metas.length ? timeAgo(metas[0].updatedAt) : '—' }
          ]}
          ctaLabel="New team"
          onCta={newSession}
          ctaDisabled={!defaultModel}
          note={!defaultModel ? 'Add an API key in Providers (or start Ollama) to begin.' : undefined}
          recent={metas.slice(0, 5).map((m) => ({
            id: m.id,
            title: m.title,
            subtitle: `${m.workerCount} worker${m.workerCount === 1 ? '' : 's'}`
          }))}
          onOpen={select}
          steps={['Set a Lead + Workers', 'Describe a task', 'Get a combined answer']}
          examples={[
            'Compare three approaches to learning a language',
            'Plan a 3-day trip to Kyoto with options',
            'Brainstorm names for a coffee brand'
          ]}
          onExample={startExample}
        />
      ) : (
        <div className="chat-main">
          <div className="swarm-setup">
            <div className="swarm-role">
              <span className="swarm-role-label" title="The lead plans the work, assigns it, and combines the results.">
                🧭 Lead
              </span>
              <ModelSelect
                models={models}
                value={`${session.managerProviderId}/${session.managerModelId}`}
                onChange={setManager}
                disabled={running}
              />
            </div>
            <div className="swarm-role swarm-workers">
              <span className="swarm-role-label" title="Workers each handle one piece of the task, at the same time.">
                👥 Workers
              </span>
              <div className="swarm-worker-list">
                {session.workers.map((w, i) => (
                  <div key={w.id} className="swarm-worker">
                    <ModelSelect
                      models={models}
                      value={`${w.providerId}/${w.modelId}`}
                      onChange={(v) => setWorker(i, v)}
                      disabled={running}
                    />
                    {session.workers.length > 1 && (
                      <button
                        className="ghost small"
                        title="Remove this worker"
                        disabled={running}
                        onClick={() => removeWorker(i)}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <button className="ghost small icon-btn" onClick={addWorker} disabled={running}>
                  <PlusIcon /> Add worker
                </button>
              </div>
              <div className="swarm-hint">
                Tip: pick workers from <strong>different providers</strong> to see them work at the
                same time. Several models on the same account (e.g. all Ollama) may take turns.
              </div>
            </div>
          </div>

          <SwarmTimeline session={session} live={live} />

          {error && <div className="chat-error">⚠ {error}</div>}

          <SectionComposer
            running={running}
            onSend={run}
            onStop={stop}
            placeholder="Describe a task for the team… (Enter to start, Shift+Enter for a new line)"
            sendLabel="Run team"
            seed={exampleSeed}
          />
        </div>
      )}
    </div>
  )
}

function SwarmTimeline({ session, live }: { session: SwarmSession; live: LiveTurn | null }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [session.turns.length, live])

  const empty = session.turns.length === 0 && !live

  return (
    <div className="chat-messages">
      {empty && (
        <div className="cowork-hint">
          Set a <strong>Lead</strong> and one or more <strong>Workers</strong> above, then describe a
          task. The lead splits it up, the workers tackle their parts in parallel, and the lead
          combines everything into one answer. Mix fast models with deep-thinking ones for the best
          speed / quality balance.
        </div>
      )}
      {session.turns.map((t, i) => (
        <SwarmTurnView
          key={i}
          task={t.task}
          statusLine=""
          subtasks={t.subtasks.map((s) => ({
            id: s.id,
            model: s.model,
            title: s.title,
            output: s.output,
            status: s.status,
            error: s.error
          }))}
          synthesis={t.synthesis}
        />
      ))}
      {live && (
        <SwarmTurnView
          task={live.task}
          statusLine={live.statusLine}
          subtasks={live.subtasks}
          synthesis={live.synthesis}
        />
      )}
      <div ref={endRef} />
    </div>
  )
}

function SwarmTurnView({
  task,
  statusLine,
  subtasks,
  synthesis
}: {
  task: string
  statusLine: string
  subtasks: LiveSub[]
  synthesis: string
}) {
  return (
    <div className="swarm-turn">
      <div className="msg msg-user">
        <div className="msg-bubble">{task}</div>
      </div>
      {statusLine && (
        <div className="swarm-status">
          <WorkingDots label={statusLine} />
        </div>
      )}
      {subtasks.length > 0 && (
        <div className="swarm-subtasks">
          {subtasks.map((s) => (
            <SwarmSubCard key={s.id} sub={s} />
          ))}
        </div>
      )}
      {synthesis && (
        <div className="swarm-synthesis">
          <div className="swarm-synthesis-label">✦ Combined answer</div>
          <div className="msg-body markdown">
            <MarkdownView>
              {synthesis}
            </MarkdownView>
          </div>
        </div>
      )}
    </div>
  )
}

function SwarmSubCard({ sub }: { sub: LiveSub }) {
  const icon = sub.status === 'done' ? '✅' : sub.status === 'error' ? '⚠' : '⟳'
  return (
    <details className={`tool-card swarm-sub ${sub.status === 'error' ? 'tool-card-error' : ''}`} open={sub.status === 'running'}>
      <summary>
        <span className="swarm-sub-icon">{icon}</span> {sub.title}
        <span className="swarm-sub-model">{sub.model.split('/').pop()}</span>
      </summary>
      {sub.status === 'error' ? (
        <div className="compare-cell-error">⚠ {sub.error}</div>
      ) : (
        <div className="markdown swarm-sub-body">
          {sub.output ? (
            <MarkdownView>
              {sub.output}
            </MarkdownView>
          ) : (
            <WorkingDots label="Working…" />
          )}
        </div>
      )}
    </details>
  )
}

