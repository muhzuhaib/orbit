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
import { PlusIcon, ForgeIcon } from './Icons'
import SectionLanding, { timeAgo } from './SectionLanding'
import { SectionComposer, promptWithAttachments } from './SectionComposer'
import { AgentStatusBar } from './AgentStatusBar'

// "Code" is the user-facing name; internal id/storage/channels stay 'forge'.
const LAST_WS_KEY = 'orbit-forge-last-workspace'

const MODE_LABELS: Record<CoworkApprovalMode, string> = {
  ask: 'Ask before every change',
  'auto-edits': 'Auto-edit files · ask for commands',
  'auto-all': 'Full auto (no prompts)'
}

const TOOL_ICONS: Record<string, string> = {
  list_files: '📂',
  read_file: '📄',
  write_file: '✏️',
  delete_file: '🗑️',
  run_command: '❯'
}

export default function ForgeView({ collapsed }: { collapsed?: boolean }) {
  const [metas, setMetas] = useState<CoworkSessionMeta[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [session, setSession] = useState<CoworkSession | null>(null)
  const [streamText, setStreamText] = useState<string | null>(null)
  const [liveEvents, setLiveEvents] = useState<CoworkEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [toolRequests, setToolRequests] = useState<CoworkToolRequestEvent[]>([])
  // Live activity indicator (elapsed / tokens / what it's doing right now)
  const [runStart, setRunStart] = useState<number | null>(null)
  const [agentTokens, setAgentTokens] = useState(0)
  const [activity, setActivity] = useState('Working…')
  const [reasoningTail, setReasoningTail] = useState('')
  const [exampleSeed, setExampleSeed] = useState('')
  const reasoningRef = useRef('')
  const sessionRef = useRef<CoworkSession | null>(null)
  sessionRef.current = session
  const streamBufRef = useRef('')

  const refreshMetas = useCallback(async () => {
    setMetas(await window.api.forge.list())
  }, [])

  useEffect(() => {
    refreshMetas()
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) =>
      setModels([...m, ...o.models])
    )
    window.api.providers.list().then(setProviders)
  }, [refreshMetas])

  useEffect(() => {
    const offEvent = window.api.forge.onEvent(({ sessionId, ev }) => {
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
        window.api.forge.get(sessionId).then((s) => {
          setSession(s)
          setStreamText(null)
          setLiveEvents([])
        })
        refreshMetas()
      }
    })
    const offTool = window.api.forge.onToolRequest((e) => {
      setToolRequests((prev) => [...prev, e])
    })
    return () => {
      offEvent()
      offTool()
    }
  }, [refreshMetas])

  const respondTool = (requestId: string, decision: 'allow' | 'always' | 'deny') => {
    window.api.forge.respondTool(requestId, decision)
    setToolRequests((prev) => prev.filter((r) => r.requestId !== requestId))
  }

  const defaultModel = useMemo(() => models[0], [models])

  const openSessionUi = (s: CoworkSession) => {
    setSession(s)
    if (s.workspace) localStorage.setItem(LAST_WS_KEY, s.workspace)
    setError(null)
    streamBufRef.current = ''
    setStreamText(null)
    setLiveEvents([])
  }

  const newSession = async () => {
    if (!defaultModel) return
    setExampleSeed('')
    const s = await window.api.forge.create(defaultModel.providerId, defaultModel.modelId)
    // Reuse the last folder if we still have one — no file dialog is forced open.
    const last = localStorage.getItem(LAST_WS_KEY)
    if (last) {
      try {
        openSessionUi(await window.api.forge.setWorkspace(s.id, last))
        refreshMetas()
        return
      } catch {
        // last folder moved/deleted — fall through to an empty session
      }
    }
    openSessionUi(s)
    refreshMetas()
  }

  const select = async (id: string) => {
    openSessionUi(await window.api.forge.get(id))
  }

  // Start a new session pre-filled with an example task (friendly first run).
  const startExample = async (prompt: string) => {
    await newSession()
    setExampleSeed(prompt)
  }

  const remove = async (id: string) => {
    await window.api.forge.delete(id)
    if (session?.id === id) setSession(null)
    refreshMetas()
  }

  const setWorkspaceByPath = async (folder: string): Promise<void> => {
    if (!session) return
    try {
      const s = await window.api.forge.setWorkspace(session.id, folder.trim())
      openSessionUi(s)
      refreshMetas()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const browseWorkspace = async () => {
    if (!session) return
    const s = await window.api.forge.pickWorkspace(session.id)
    openSessionUi(s)
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
    window.api.forge.send(session.id, text)
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
          icon={<ForgeIcon />}
          title="What are we building?"
          subtitle="A developer coding agent that works right inside your project folder — it reads the codebase, runs git and your tests, reads the errors, and writes & refactors code."
          stats={[
            { label: 'Sessions', value: metas.length },
            { label: 'Projects', value: new Set(metas.map((m) => m.workspace).filter(Boolean)).size },
            { label: 'Last active', value: metas.length ? timeAgo(metas[0].updatedAt) : '—' }
          ]}
          ctaLabel="Start a new session"
          onCta={newSession}
          ctaDisabled={!defaultModel}
          note={!defaultModel ? 'Add an API key in Providers (or start Ollama) to begin.' : undefined}
          recent={metas.slice(0, 5).map((m) => ({
            id: m.id,
            title: m.title,
            subtitle: m.workspace ? shortenPath(m.workspace) : 'no folder yet'
          }))}
          onOpen={select}
          steps={['Point it at a folder', 'Describe a task', 'Review & approve']}
          examples={[
            'Add a dark-mode toggle to this app',
            'Find and fix the failing tests',
            'Explain what this codebase does'
          ]}
          onExample={startExample}
        />
      ) : (
        <div className="chat-main">
          <div className="chat-toolbar cowork-toolbar forge-toolbar">
            <button className="ghost small forge-back" onClick={() => setSession(null)} title="Back to Code home">
              ← Home
            </button>
            <WorkspaceField
              value={session.workspace}
              disabled={running}
              onSet={setWorkspaceByPath}
              onBrowse={browseWorkspace}
            />
            <ModelSelect
              models={models}
              value={`${session.providerId}/${session.modelId}`}
              onChange={async (value) => {
                const [providerId, ...rest] = value.split('/')
                setSession(await window.api.forge.update(session.id, { providerId, modelId: rest.join('/') }))
              }}
              disabled={running}
            />
            <select
              value={session.mode}
              onChange={async (e) =>
                setSession(
                  await window.api.forge.update(session.id, {
                    mode: e.target.value as CoworkApprovalMode
                  })
                )
              }
              title="When should Code ask for your permission?"
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
                  setSession(await window.api.forge.update(session.id, { effort: v }))
                }
              />
            )}
          </div>

          <Terminal
            workspace={session.workspace}
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
                      ✏️ Code wants to edit{' '}
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
                      {TOOL_ICONS[r.toolName] ?? '🔧'} Code wants to run{' '}
                      <strong>
                        {r.toolName === 'run_command'
                          ? String((r.args as Record<string, unknown>)?.command ?? 'a command')
                          : r.toolName}
                      </strong>
                      {r.toolName !== 'run_command' && (
                        <code className="tool-args">{JSON.stringify(r.args)}</code>
                      )}
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
            onStop={() => window.api.forge.stop(session.id)}
            placeholder={
              session.workspace
                ? 'Tell Code what to build or fix… (Enter to run, Shift+Enter for a new line)'
                : 'Set a project folder first (paste a path or Browse above)'
            }
            sendLabel="Run"
            seed={exampleSeed}
          />
        </div>
      )}
    </div>
  )
}

/** Folder chooser: paste/type a path (Claude-Code style) OR click Browse for a dialog. */
function WorkspaceField({
  value,
  disabled,
  onSet,
  onBrowse
}: {
  value: string | null
  disabled?: boolean
  onSet: (folder: string) => void
  onBrowse: () => void
}) {
  const [text, setText] = useState(value ?? '')
  useEffect(() => setText(value ?? ''), [value])
  return (
    <div className="forge-ws-field">
      <span className="forge-ws-prompt">📁</span>
      <input
        className="forge-ws-input"
        value={text}
        disabled={disabled}
        placeholder="Paste a project folder path, then press Enter…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (text.trim()) onSet(text)
          }
        }}
        title={value ?? 'The folder Code works in'}
      />
      <button className="ghost small" onClick={onBrowse} disabled={disabled} title="Browse for a folder">
        Browse…
      </button>
    </div>
  )
}

function Terminal({
  workspace,
  events,
  streamText,
  runStart,
  tokens,
  activity,
  reasoningTail
}: {
  workspace: string | null
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

  const prompt = workspace ? `${shortenPath(workspace)} ❯` : 'code ❯'

  return (
    <div className="chat-messages forge-terminal">
      {events.length === 0 && streamText === null && (
        <div className="forge-hint">
          <div className="forge-prompt-line">{prompt}</div>
          {workspace
            ? 'Tell Code what to build or fix — e.g. “run the tests and fix whatever’s failing”, “add a dark-mode toggle to the settings page”, or “review git diff and write a commit message”.'
            : 'Set a project folder above (paste a path or Browse), then describe what to build or fix. Code works like a coding agent in a terminal.'}
        </div>
      )}
      {events.map((ev, i) => (
        <TerminalEvent key={i} ev={ev} prompt={prompt} />
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

function TerminalEvent({ ev, prompt }: { ev: CoworkEvent; prompt: string }) {
  switch (ev.type) {
    case 'user':
      return (
        <div className="forge-user-line">
          <span className="forge-prompt">{prompt}</span> {ev.text}
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
        <details className="tool-card forge-tool">
          <summary>
            {TOOL_ICONS[ev.toolName] ?? '🔧'} {toolCallSummary(ev.toolName, ev.args)}
          </summary>
          <code className="tool-args">{JSON.stringify(ev.args, null, 2)}</code>
        </details>
      )
    case 'tool-result':
      return (
        <details className={`tool-card tool-card-result forge-tool ${ev.error ? 'tool-card-error' : ''}`}>
          <summary>
            {ev.error ? '⚠' : '✓'} {ev.toolName} {ev.error ? 'failed' : 'done'}
            {!ev.error && ` — ${firstLine(ev.result)}`}
            {ev.diff && <span className="diff-summary"> ({diffSummary(ev.diff)})</span>}
          </summary>
          {ev.diff ? <DiffView lines={ev.diff} /> : <code className="tool-args forge-output">{ev.result}</code>}
        </details>
      )
    case 'status':
      return <div className="msg-note">{ev.text}</div>
    case 'error':
      return <div className="chat-error">⚠ {ev.text}</div>
  }
}

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
            {b.text || ' '}
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
      return `list${a.dir ? ` ${a.dir}` : ''}`
    case 'read_file':
      return `read ${a.path ?? 'a file'}`
    case 'write_file':
      return `write ${a.path ?? 'a file'}`
    case 'delete_file':
      return `delete ${a.path ?? 'a file'}`
    case 'run_command':
      return `${a.command ?? 'a command'}`
    default:
      return toolName
  }
}

function firstLine(s: string): string {
  const line = s.split('\n', 1)[0]
  return line.length > 80 ? `${line.slice(0, 80)}…` : line
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

function shortenPath(p: string): string {
  if (p.length <= 38) return p
  const parts = p.split(/[\\/]/)
  const tail = parts.slice(-2).join('\\')
  return `${parts[0]}\\…\\${tail}`
}

