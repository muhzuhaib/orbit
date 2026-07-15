import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ChatAttachment,
  ModelInfo,
  ProviderInfo,
  StudioSession,
  StudioSessionMeta
} from '../../../shared/types'
import ModelSelect from './ModelSelect'
import { ThinkingSelect } from './ThinkingSelect'
import { supportsThinking } from '../../../shared/modelCatalog'
import { PlusIcon, StudioIcon } from './Icons'
import SectionLanding, { timeAgo } from './SectionLanding'
import { SectionComposer, promptWithAttachments } from './SectionComposer'

type Device = 'desktop' | 'tablet' | 'mobile'
const DEVICE_WIDTH: Record<Device, number | null> = { desktop: null, tablet: 820, mobile: 390 }

export default function StudioView({ collapsed }: { collapsed?: boolean }) {
  const [metas, setMetas] = useState<StudioSessionMeta[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [session, setSession] = useState<StudioSession | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string>('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showCode, setShowCode] = useState(false)
  const [device, setDevice] = useState<Device>('desktop')
  const [activeIdx, setActiveIdx] = useState<number | null>(null)
  const htmlRef = useRef<string>('')
  const [html, setHtml] = useState<string>('')
  const [exampleSeed, setExampleSeed] = useState('')
  const sessionRef = useRef<StudioSession | null>(null)
  sessionRef.current = session

  const refreshMetas = useCallback(async () => {
    setMetas(await window.api.studio.list())
  }, [])

  useEffect(() => {
    refreshMetas()
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) =>
      setModels([...m, ...o.models])
    )
    window.api.providers.list().then(setProviders)
  }, [refreshMetas])

  useEffect(() => {
    const off = window.api.studio.onEvent(({ sessionId, ev }) => {
      if (sessionId !== sessionRef.current?.id) return
      if (ev.type === 'status') {
        setStatus(ev.text)
      } else if (ev.type === 'code-delta') {
        setStatus((s) => (s.startsWith('Designing') ? s : 'Designing…'))
      } else if (ev.type === 'preview') {
        htmlRef.current = ev.html
        setHtml(ev.html)
        setPreviewUrl(ev.url)
        setShowCode(false)
      } else if (ev.type === 'done' || ev.type === 'error') {
        if (ev.type === 'error') setError(ev.message)
        setRunning(false)
        setStatus('')
        window.api.studio.get(sessionId).then((s) => {
          setSession(s)
          setActiveIdx(s.turns.length ? s.turns.length - 1 : null)
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
    const s = await window.api.studio.create(defaultModel.providerId, defaultModel.modelId)
    setSession(s)
    setPreviewUrl(null)
    setHtml('')
    htmlRef.current = ''
    setError(null)
    setShowCode(false)
    setActiveIdx(null)
    refreshMetas()
  }

  // Start a new design pre-filled with an example prompt (friendly first run).
  const startExample = async (prompt: string) => {
    await newSession()
    setExampleSeed(prompt)
  }

  const select = async (id: string) => {
    const s = await window.api.studio.get(id)
    setSession(s)
    setError(null)
    setShowCode(false)
    setStatus('')
    if (s.turns.length > 0) {
      await showTurn(s, s.turns.length - 1)
    } else {
      setPreviewUrl(null)
      setHtml('')
      htmlRef.current = ''
      setActiveIdx(null)
    }
  }

  const showTurn = async (s: StudioSession, idx: number) => {
    const turn = s.turns[idx]
    if (!turn) return
    htmlRef.current = turn.html
    setHtml(turn.html)
    setShowCode(false)
    setActiveIdx(idx)
    setPreviewUrl(await window.api.studio.previewUrl(turn.html))
  }

  const remove = async (id: string) => {
    await window.api.studio.delete(id)
    if (session?.id === id) setSession(null)
    refreshMetas()
  }

  const setModel = async (value: string) => {
    if (!session) return
    const [providerId, ...rest] = value.split('/')
    setSession(await window.api.studio.update(session.id, { providerId, modelId: rest.join('/') }))
  }

  const run = (text: string, attachments: ChatAttachment[] = []) => {
    if (!session) return
    const prompt = promptWithAttachments(text, attachments)
    setError(null)
    setRunning(true)
    setStatus('Designing…')
    setActiveIdx(null)
    window.api.studio.run(session.id, prompt)
  }
  const stop = () => session && window.api.studio.stop(session.id)

  const save = () => {
    if (!htmlRef.current) return
    const name = (session?.title || 'design').replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    window.api.chat.exportText(htmlRef.current, `${name}.html`)
  }
  const copyCode = () => htmlRef.current && navigator.clipboard.writeText(htmlRef.current)
  const openWindow = () => htmlRef.current && window.api.studio.openWindow(htmlRef.current)

  const hasDesign = html.length > 0

  return (
    <div className="chats">
      <div className={`chat-list ${collapsed ? 'collapsed' : ''}`}>
        <button className="new-chat icon-btn" onClick={newSession} disabled={!defaultModel}>
          <PlusIcon /> New design
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
          icon={<StudioIcon />}
          title="What shall we design?"
          subtitle="Describe a website, landing page or UI in plain words — Orbit designs it and shows a live preview you can keep refining. Everything runs offline in a single HTML file."
          stats={[
            { label: 'Designs', value: metas.length },
            { label: 'Last active', value: metas.length ? timeAgo(metas[0].updatedAt) : '—' }
          ]}
          ctaLabel="New design"
          onCta={newSession}
          ctaDisabled={!defaultModel}
          note={!defaultModel ? 'Add an API key in Providers (or start Ollama) to begin.' : undefined}
          recent={metas.slice(0, 5).map((m) => ({ id: m.id, title: m.title, subtitle: timeAgo(m.updatedAt) }))}
          onOpen={select}
          steps={['Describe a UI', 'Preview it live', 'Refine & save']}
          examples={[
            'A pricing page for a coffee subscription',
            'A personal portfolio landing page',
            'A cozy weather app dashboard'
          ]}
          onExample={startExample}
        />
      ) : (
        <div className="studio-main">
          {/* LEFT: conversation / prompt history + composer */}
          <div className="studio-side">
            <div className="studio-side-head">
              <ModelSelect
                models={models}
                value={`${session.providerId}/${session.modelId}`}
                onChange={setModel}
                disabled={running}
              />
              {supportsThinking(
                providers.find((p) => p.id === session.providerId)?.kind,
                session.modelId
              ) && (
                <ThinkingSelect
                  disabled={running}
                  value={session.effort ?? 'off'}
                  onChange={async (v) =>
                    setSession(await window.api.studio.update(session.id, { effort: v }))
                  }
                />
              )}
            </div>
            <StudioConversation
              turns={session.turns}
              activeIdx={activeIdx}
              running={running}
              status={status}
              error={error}
              onSelect={(i) => showTurn(session, i)}
            />
            <SectionComposer
              running={running}
              onSend={run}
              onStop={stop}
              placeholder={
                hasDesign
                  ? 'Describe a change… (Enter to update, Shift+Enter for a new line)'
                  : 'Describe the page or UI you want… (Enter to design, Shift+Enter for a new line)'
              }
              sendLabel={hasDesign ? 'Update design' : 'Design it'}
              seed={exampleSeed}
            />
          </div>

          {/* RIGHT: the design canvas */}
          <div className="studio-canvas-wrap">
            <div className="studio-canvas-bar">
              <div className="studio-devices">
                {(['desktop', 'tablet', 'mobile'] as Device[]).map((d) => (
                  <button
                    key={d}
                    className={`studio-device ${device === d ? 'active' : ''}`}
                    onClick={() => setDevice(d)}
                    title={d[0].toUpperCase() + d.slice(1)}
                  >
                    {d === 'desktop' ? '🖥' : d === 'tablet' ? '▭' : '▯'}
                  </button>
                ))}
              </div>
              <div className="composer-spacer" />
              {hasDesign && (
                <>
                  <button className="ghost small" onClick={() => setShowCode((c) => !c)}>
                    {showCode ? '🖼 Preview' : '⌨ Code'}
                  </button>
                  <button className="ghost small" onClick={openWindow} title="Open full size in a window">
                    ⤢ Open
                  </button>
                  <button className="ghost small" onClick={copyCode}>
                    Copy
                  </button>
                  <button className="ghost small" onClick={save}>
                    ⬇ Save
                  </button>
                </>
              )}
            </div>

            <div className="studio-canvas">
              {showCode ? (
                <pre className="studio-code">{html}</pre>
              ) : previewUrl ? (
                <div
                  className={`studio-viewport device-${device}`}
                  style={DEVICE_WIDTH[device] ? { width: DEVICE_WIDTH[device]! } : undefined}
                >
                  <iframe
                    key={previewUrl + device}
                    className="studio-frame"
                    src={previewUrl}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    title="Design preview"
                  />
                </div>
              ) : (
                <div className="studio-empty">
                  {running ? (
                    <div className="studio-building">
                      <span className="thinking-dots">✦</span>
                      <div>{status || 'Designing…'}</div>
                    </div>
                  ) : (
                    <div className="cowork-hint">
                      Describe what you want on the left — e.g. “a landing page for a coffee shop with a
                      hero image, menu and a contact form” — then keep refining it (“make it dark”, “add
                      a pricing section”). Your design appears here.
                    </div>
                  )}
                </div>
              )}
              {running && previewUrl && (
                <div className="studio-overlay">
                  <span className="thinking-dots">✦</span> {status || 'Updating…'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StudioConversation({
  turns,
  activeIdx,
  running,
  status,
  error,
  onSelect
}: {
  turns: StudioSession['turns']
  activeIdx: number | null
  running: boolean
  status: string
  error: string | null
  onSelect: (i: number) => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [turns.length, running])

  return (
    <div className="studio-conversation">
      {turns.length === 0 && !running && (
        <div className="studio-conv-hint">
          Your prompts appear here. Each new prompt refines the design — you can click any earlier
          prompt to bring that version back.
        </div>
      )}
      {turns.map((t, i) => (
        <button
          key={i}
          className={`studio-turn ${activeIdx === i ? 'active' : ''}`}
          onClick={() => onSelect(i)}
          title="Show this version"
        >
          <span className="studio-turn-idx">v{i + 1}</span>
          <span className="studio-turn-text">{t.prompt}</span>
        </button>
      ))}
      {running && (
        <div className="studio-turn running">
          <span className="thinking-dots">✦</span>
          <span className="studio-turn-text">{status || 'Designing…'}</span>
        </div>
      )}
      {error && <div className="chat-error studio-conv-error">⚠ {error}</div>}
      <div ref={endRef} />
    </div>
  )
}

