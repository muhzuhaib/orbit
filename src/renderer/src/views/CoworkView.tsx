import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MarkdownView } from './MarkdownView'
import type {
  ChatAttachment,
  CoworkApprovalMode,
  CoworkEvent,
  CoworkSession,
  CoworkSessionMeta,
  CoworkToolRequestEvent,
  DiffLine,
  ModelInfo,
  ProviderInfo
} from '../../../shared/types'
import { collapseContext, diffSummary } from '../../../shared/diff'
import { supportsThinking } from '../../../shared/modelCatalog'
import 'highlight.js/styles/github-dark.css'
import ModelSelect from './ModelSelect'
import { ThinkingSelect } from './ThinkingSelect'
import SectionLanding, { timeAgo } from './SectionLanding'
import { CoworkIcon, PlusIcon } from './Icons'
import { AgentStatusBar } from './AgentStatusBar'
import { SectionComposer, promptWithAttachments } from './SectionComposer'

const MODE_LABELS: Record<CoworkApprovalMode, string> = {
  ask: 'Ask before every change',
  'auto-edits': 'Auto-approve file edits',
  'auto-all': 'Auto-approve everything'
}

const TOOL_ICONS: Record<string, string> = {
  list_files: '📂',
  read_file: '📄',
  write_file: '✏️',
  delete_file: '🗑️',
  run_command: '💻'
}

export default function CoworkView({ collapsed }: { collapsed?: boolean }) {
  const [metas, setMetas] = useState<CoworkSessionMeta[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [session, setSession] = useState<CoworkSession | null>(null)
  const [streamText, setStreamText] = useState<string | null>(null)
  const [liveEvents, setLiveEvents] = useState<CoworkEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toolRequests, setToolRequests] = useState<CoworkToolRequestEvent[]>([])
  // Live activity indicator (elapsed / tokens / current action)
  const [runStart, setRunStart] = useState<number | null>(null)
  const [agentTokens, setAgentTokens] = useState(0)
  const [activity, setActivity] = useState('Working…')
  const [reasoningTail, setReasoningTail] = useState('')
  const [exampleSeed, setExampleSeed] = useState('')
  const reasoningRef = useRef('')
  const sessionRef = useRef<CoworkSession | null>(null)
  sessionRef.current = session
  // Stream buffer lives in a ref: StrictMode double-invokes state updaters,
  // so deriving timeline entries inside one would duplicate them.
  const streamBufRef = useRef('')

  const refreshMetas = useCallback(async () => {
    setMetas(await window.api.cowork.list())
  }, [])

  useEffect(() => {
    refreshMetas()
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) =>
      setModels([...m, ...o.models])
    )
    window.api.providers.list().then(setProviders)
  }, [refreshMetas])

  useEffect(() => {
    const offEvent = window.api.cowork.onEvent(({ sessionId, ev }) => {
      if (sessionId !== sessionRef.current?.id) return
      if (ev.type === 'text-delta') {
        streamBufRef.current += ev.delta
        setStreamText(streamBufRef.current)
        setActivity('Writing…')
      } else if (ev.type === 'reasoning-delta') {
        reasoningRef.current += ev.delta
        setReasoningTail(reasoningTailOf(reasoningRef.current))
        setActivity('Thinking…')
      } else if (ev.type === 'usage') {
        setAgentTokens((t) => t + ev.stepTokens)
      } else if (ev.type === 'tool-call') {
        // close the streaming text block into the live timeline
        const buf = streamBufRef.current
        streamBufRef.current = ''
        setStreamText('')
        setActivity(activityForTool(ev.toolName))
        setLiveEvents((es) => [
          ...(buf.trim() ? [...es, { type: 'text', text: buf, at: Date.now() } as CoworkEvent] : es),
          { type: 'tool-call', toolName: ev.toolName, args: ev.args, at: Date.now() }
        ])
      } else if (ev.type === 'tool-result') {
        setActivity('Working…')
        setLiveEvents((es) => [
          ...es,
          { type: 'tool-result', toolName: ev.toolName, result: ev.result, error: ev.error, at: Date.now() }
        ])
      } else if (ev.type === 'done' || ev.type === 'error') {
        if (ev.type === 'error') setError(ev.message)
        streamBufRef.current = ''
        reasoningRef.current = ''
        setReasoningTail('')
        setRunStart(null)
        window.api.cowork.get(sessionId).then((s) => {
          setSession(s)
          setStreamText(null)
          setLiveEvents([])
        })
        refreshMetas()
      }
    })
    const offTool = window.api.cowork.onToolRequest((e) => {
      setToolRequests((prev) => [...prev, e])
    })
    return () => {
      offEvent()
      offTool()
    }
  }, [refreshMetas])

  const respondTool = (requestId: string, decision: 'allow' | 'always' | 'deny') => {
    window.api.cowork.respondTool(requestId, decision)
    setToolRequests((prev) => prev.filter((r) => r.requestId !== requestId))
  }

  const defaultModel = useMemo(() => models[0], [models])

  const newSession = async () => {
    if (!defaultModel) return
    setExampleSeed('')
    const s = await window.api.cowork.create(defaultModel.providerId, defaultModel.modelId)
    setSession(s)
    setError(null)
    setStreamText(null)
    setLiveEvents([])
    refreshMetas()
    // choosing the folder is the first thing a new session needs
    setSession(await window.api.cowork.pickWorkspace(s.id))
  }

  // Start a new session pre-filled with an example task (friendly first run).
  const startExample = async (prompt: string) => {
    await newSession()
    setExampleSeed(prompt)
  }

  const select = async (id: string) => {
    setSession(await window.api.cowork.get(id))
    setError(null)
    streamBufRef.current = ''
    setStreamText(null)
    setLiveEvents([])
  }

  const remove = async (id: string) => {
    await window.api.cowork.delete(id)
    if (session?.id === id) setSession(null)
    refreshMetas()
  }

  const send = (raw: string, attachments: ChatAttachment[] = []) => {
    if (!session) return
    const text = promptWithAttachments(raw, attachments)
    setError(null)
    setSession({ ...session, events: [...session.events, { type: 'user', text, at: Date.now() }] })
    streamBufRef.current = ''
    reasoningRef.current = ''
    setReasoningTail('')
    setStreamText('')
    setRunStart(Date.now())
    setAgentTokens(0)
    setActivity('Thinking…')
    window.api.cowork.send(session.id, text)
  }

  const running = streamText !== null

  return (
    <div className="chats">
      <div className={`chat-list ${collapsed ? 'collapsed' : ''}`}>
        <button className="new-chat icon-btn" onClick={newSession} disabled={!defaultModel}>
          <PlusIcon /> New session
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
          icon={<CoworkIcon />}
          title="Let’s get things done"
          subtitle="Give the AI a folder and a task — it works in the folder for you, asking before it changes anything. Great for organising files, drafting docs, and everyday automation."
          stats={[
            { label: 'Sessions', value: metas.length },
            { label: 'Folders', value: new Set(metas.map((m) => m.workspace).filter(Boolean)).size },
            { label: 'Last active', value: metas.length ? timeAgo(metas[0].updatedAt) : '—' }
          ]}
          ctaLabel="Start a new session"
          onCta={newSession}
          ctaDisabled={!defaultModel}
          note={!defaultModel ? 'Add an API key in Providers (or start Ollama) to begin.' : undefined}
          recent={metas.slice(0, 5).map((m) => ({
            id: m.id,
            title: m.title,
            subtitle: m.workspace ? m.workspace.split(/[\\/]/).pop() : 'no folder yet'
          }))}
          onOpen={select}
          steps={['Choose a folder', 'Describe a task', 'Approve changes']}
          examples={[
            'Organise this folder into subfolders by type',
            'Summarise every document into notes.md',
            'Rename these files to a consistent format'
          ]}
          onExample={startExample}
        />
      ) : (
        <div className="chat-main">
          <div className="chat-toolbar cowork-toolbar">
            <button
              className="ghost workspace-btn"
              title={session.workspace ?? 'Choose the folder Assistant may work in'}
              onClick={async () => setSession(await window.api.cowork.pickWorkspace(session.id))}
              disabled={running}
            >
              📂 {session.workspace ? shortenPath(session.workspace) : 'Choose folder…'}
            </button>
            <ModelSelect
              models={models}
              value={`${session.providerId}/${session.modelId}`}
              onChange={async (value) => {
                const [providerId, ...rest] = value.split('/')
                setSession(
                  await window.api.cowork.update(session.id, { providerId, modelId: rest.join('/') })
                )
              }}
              disabled={running}
            />
            <select
              value={session.mode}
              onChange={async (e) =>
                setSession(
                  await window.api.cowork.update(session.id, {
                    mode: e.target.value as CoworkApprovalMode
                  })
                )
              }
              title="When should Assistant ask for your permission?"
            >
              {(Object.keys(MODE_LABELS) as CoworkApprovalMode[]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
            {supportsThinking(
              providers.find((p) => p.id === session.providerId)?.kind,
              session.modelId
            ) && (
              <ThinkingSelect
                disabled={running}
                value={session.effort ?? 'off'}
                onChange={async (v) =>
                  setSession(await window.api.cowork.update(session.id, { effort: v }))
                }
              />
            )}
          </div>

          <Timeline
            events={[...session.events, ...liveEvents]}
            streamText={streamText}
            runStart={running ? runStart : null}
            tokens={agentTokens}
            activity={activity}
            reasoningTail={reasoningTail}
          />

          {error && <div className="chat-error">⚠ {error}</div>}

          {toolRequests
            .filter((r) => r.sessionId === session.id)
            .slice(0, 1)
            .map((r) => (
              <div key={r.requestId} className="tool-approval">
                <div className="tool-approval-text">
                  {r.diff !== undefined ? (
                    <>
                      ✏️ Assistant wants to edit{' '}
                      <strong>{String((r.args as Record<string, unknown>)?.path ?? 'a file')}</strong>
                      {r.diffSummary && <span className="diff-summary"> ({r.diffSummary})</span>}
                      {r.diff ? (
                        <DiffView lines={r.diff} />
                      ) : (
                        <code className="tool-args">
                          File is too large to preview — the full content will be replaced.
                        </code>
                      )}
                    </>
                  ) : (
                    <>
                      {TOOL_ICONS[r.toolName] ?? '🔧'} Assistant wants to run <strong>{r.toolName}</strong>
                      <code className="tool-args">{JSON.stringify(r.args)}</code>
                    </>
                  )}
                </div>
                <div className="composer-actions">
                  <button onClick={() => respondTool(r.requestId, 'allow')}>Allow once</button>
                  <button onClick={() => respondTool(r.requestId, 'always')}>
                    Always allow (this session)
                  </button>
                  <button className="danger" onClick={() => respondTool(r.requestId, 'deny')}>
                    Deny
                  </button>
                </div>
              </div>
            ))}

          <SectionComposer
            running={running}
            disabled={!session.workspace}
            onSend={send}
            onStop={() => window.api.cowork.stop(session.id)}
            placeholder={
              session.workspace
                ? 'Describe a task… (Enter to start, Shift+Enter for a new line)'
                : 'Choose a workspace folder first (📂 button above)'
            }
            sendLabel="Start task"
            seed={exampleSeed}
          />
        </div>
      )}
    </div>
  )
}

function Timeline({
  events,
  streamText,
  runStart,
  tokens,
  activity,
  reasoningTail
}: {
  events: CoworkEvent[]
  streamText: string | null
  runStart: number | null
  tokens: number
  activity: string
  reasoningTail: string
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [events.length, streamText, activity, tokens])

  return (
    <div className="chat-messages">
      {events.length === 0 && streamText === null && (
        <div className="cowork-hint">
          Pick a folder above, then describe a task — e.g. “organize the files in this folder into
          subfolders by type” or “read report.txt and write a one-page summary”.
        </div>
      )}
      {events.map((ev, i) => (
        <TimelineEvent key={i} ev={ev} />
      ))}
      {streamText ? (
        <div className="msg msg-assistant">
          <div className="msg-body markdown">
            <MarkdownView>
              {streamText}
            </MarkdownView>
          </div>
        </div>
      ) : null}
      {runStart !== null && (
        <AgentStatusBar
          startedAt={runStart}
          tokens={tokens}
          activity={activity}
          detail={reasoningTail || undefined}
        />
      )}
      <div ref={endRef} />
    </div>
  )
}

/** Friendly "what it's doing now" label for the live status bar. */
function activityForTool(toolName: string): string {
  switch (toolName) {
    case 'write_file':
      return 'Writing a file…'
    case 'read_file':
      return 'Reading a file…'
    case 'list_files':
      return 'Exploring files…'
    case 'delete_file':
      return 'Deleting a file…'
    case 'run_command':
      return 'Running a command…'
    default:
      return `Running ${toolName}…`
  }
}

/** Last little bit of the reasoning stream, shown dimmed next to "Thinking…". */
function reasoningTailOf(full: string): string {
  const flat = full.replace(/\s+/g, ' ').trim()
  return flat.length > 90 ? `…${flat.slice(-90)}` : flat
}

function TimelineEvent({ ev }: { ev: CoworkEvent }) {
  switch (ev.type) {
    case 'user':
      return (
        <div className="msg msg-user">
          <div className="msg-bubble">{ev.text}</div>
        </div>
      )
    case 'text':
      return (
        <div className="msg msg-assistant">
          <div className="msg-body markdown">
            <MarkdownView>
              {ev.text}
            </MarkdownView>
          </div>
        </div>
      )
    case 'tool-call':
      return (
        <details className="tool-card">
          <summary>
            {TOOL_ICONS[ev.toolName] ?? '🔧'} {toolCallSummary(ev.toolName, ev.args)}
          </summary>
          <code className="tool-args">{JSON.stringify(ev.args, null, 2)}</code>
        </details>
      )
    case 'tool-result':
      return (
        <details className={`tool-card tool-card-result ${ev.error ? 'tool-card-error' : ''}`}>
          <summary>
            {ev.error ? '⚠' : '✅'} {ev.toolName} {ev.error ? 'failed' : 'finished'}
            {!ev.error && ` — ${firstLine(ev.result)}`}
            {ev.diff && <span className="diff-summary"> ({diffSummary(ev.diff)})</span>}
          </summary>
          {ev.diff ? <DiffView lines={ev.diff} /> : <code className="tool-args">{ev.result}</code>}
        </details>
      )
    case 'status':
      return <div className="msg-note">{ev.text}</div>
    case 'error':
      return <div className="chat-error">⚠ {ev.text}</div>
  }
}

/** Git-style red/green line diff with unchanged runs folded away. */
function DiffView({ lines }: { lines: DiffLine[] }) {
  const blocks = collapseContext(lines, 3)
  return (
    <div className="diff">
      {blocks.map((b, i) =>
        b.t === 'skip' ? (
          <div key={i} className="diff-line diff-skip">
            ⋯ {b.count} unchanged line{b.count === 1 ? '' : 's'}
          </div>
        ) : (
          <div key={i} className={`diff-line diff-${b.t}`}>
            <span className="diff-sign">{b.t === 'add' ? '+' : b.t === 'del' ? '−' : ' '}</span>
            {b.text || ' '}
          </div>
        )
      )}
    </div>
  )
}

function toolCallSummary(toolName: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>
  switch (toolName) {
    case 'list_files':
      return `Listing files${a.dir ? ` in ${a.dir}` : ''}`
    case 'read_file':
      return `Reading ${a.path ?? 'a file'}`
    case 'write_file':
      return `Writing ${a.path ?? 'a file'}`
    case 'delete_file':
      return `Deleting ${a.path ?? 'a file'}`
    case 'run_command':
      return `Running: ${a.command ?? 'a command'}`
    default:
      return toolName
  }
}

function firstLine(s: string): string {
  const line = s.split('\n', 1)[0]
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
}

function shortenPath(p: string): string {
  if (p.length <= 38) return p
  const parts = p.split(/[\\/]/)
  const tail = parts.slice(-2).join('\\')
  return `${parts[0]}\\…\\${tail}`
}

