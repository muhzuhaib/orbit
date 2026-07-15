import { useCallback, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react'
import { MarkdownView } from './MarkdownView'
import type {
  ChatAttachment,
  Conversation,
  ConversationMeta,
  ConversationSearchHit,
  Folder,
  ModelInfo,
  PromptTemplate,
  ProviderInfo,
  ToolRequestEvent,
  VerifyReport
} from '../../../shared/types'
import 'highlight.js/styles/github-dark.css'
import ModelSelect from './ModelSelect'
import { ThinkingSelect, type Effort } from './ThinkingSelect'
import { supportsThinking, classifyModel } from '../../../shared/modelCatalog'
import { estimateCost, formatCost } from '../../../shared/modelPricing'
import { useBetaFlag } from '../betaFlags'
import {
  AUTOPILOT_ID,
  addAutopilotSavings,
  bestModel,
  defaultClassifier,
  fastModel,
  getAutopilotSavings,
  getAutopilotSettings,
  heuristicDifficulty,
  priciestModel,
  routeModel,
  type Difficulty
} from '../autopilot'
import { pickDefaultModel, setLastModel } from '../prefs'
import { confirmDialog } from '../confirm'
import { useDictation } from '../dictation'
import {
  AttachIcon,
  BrainIcon,
  CameraIcon,
  CloseIcon,
  CoinIcon,
  CopyIcon,
  DotsIcon,
  EditIcon,
  GlobeIcon,
  MicIcon,
  PinIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  SpeakerIcon,
  StopIcon,
  TemplateIcon,
  TrashIcon,
  WorkingDots
} from './Icons'
import { ProviderLogo, hasProviderLogo } from './ProviderLogos'

// ---------- Tool-activity cards (Claude-style) ----------
// The main process wraps tool calls/results in ⟦tool⟧summary⟦body⟧body⟦/tool⟧
// sentinels streamed into the reply. renderReply() splits the content on those
// sentinels so each becomes a clean <ToolCard> (a friendly label and — for web
// search — a collapsible Sources list) while the rest renders as normal markdown.
function ToolCard({ summary, body }: { summary: string; body?: string }): JSX.Element {
  if (!body) return <div className="tool-card-line">{summary}</div>
  return (
    <details className="tool-card">
      <summary>{summary}</summary>
      <div className="tool-card-body">
        <MarkdownView>{body}</MarkdownView>
      </div>
    </details>
  )
}

// A small per-message identity chip (provider avatar + model name) at the top of
// each assistant reply, so long multi-model chats stay scannable at a glance.
function AssistantIdentity({ model }: { model?: string }): JSX.Element | null {
  if (!model) return null
  const slash = model.indexOf('/')
  const providerId = slash >= 0 ? model.slice(0, slash) : ''
  const modelId = slash >= 0 ? model.slice(slash + 1) : model
  return (
    <div className="msg-identity">
      <span className="msg-avatar">
        {hasProviderLogo(providerId) ? (
          <ProviderLogo id={providerId} className="msg-avatar-logo" />
        ) : (
          <span className="msg-avatar-initial">{(providerId || modelId || '?').charAt(0).toUpperCase()}</span>
        )}
      </span>
      <span className="msg-identity-name">{modelId}</span>
    </div>
  )
}

const SEARCH_PREFIX = '🔎 Searched the web'
function isSearchSummary(s: string): boolean {
  return s.startsWith(SEARCH_PREFIX)
}
// Pull the query out of a "🔎 Searched the web — “query”" summary.
function searchQuery(summary: string): string {
  const m = summary.match(/—\s*[“”"]?(.+?)[“”"]?\s*$/)
  return m ? m[1].trim() : ''
}

// One card for a whole run of web searches in a reply, so a model that fires
// several searches shows a single "Searched the web · N searches" block (each
// query + its sources inside) instead of N separate cards flooding the chat.
function SearchGroupCard({ searches }: { searches: { query: string; body?: string }[] }): JSX.Element {
  const n = searches.length
  if (n === 1 && !searches[0].body) {
    const q = searches[0].query
    return <div className="tool-card-line">{`🔎 Searched the web${q ? ` — “${q}”` : ''}`}</div>
  }
  const label =
    n === 1
      ? `🔎 Searched the web${searches[0].query ? ` — “${searches[0].query}”` : ''}`
      : `🔎 Searched the web · ${n} searches`
  return (
    <details className="tool-card">
      <summary>{label}</summary>
      <div className="tool-card-body">
        {searches.map((s, i) => (
          <div className="search-item" key={i}>
            {n > 1 && <div className="search-q">🔎 {s.query || '…'}</div>}
            {s.body ? (
              <MarkdownView>{s.body}</MarkdownView>
            ) : (
              <div className="search-empty">No live results.</div>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}

/** Render an assistant reply, turning ⟦tool⟧ sentinels into tool cards. */
function renderReply(content: string): JSX.Element[] {
  type Seg = { kind: 'text'; text: string } | { kind: 'tool'; summary: string; body?: string }
  const re = /⟦tool⟧([\s\S]*?)⟦\/tool⟧/g
  const segs: Seg[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    const before = content.slice(last, m.index)
    if (before.trim()) segs.push({ kind: 'text', text: before })
    const [summary, body] = m[1].split('⟦body⟧')
    segs.push({ kind: 'tool', summary: summary.trim(), body: body?.trim() || undefined })
    last = m.index + m[0].length
  }
  const tail = content.slice(last)
  if (tail.trim() || segs.length === 0) segs.push({ kind: 'text', text: tail })

  const out: JSX.Element[] = []
  let k = 0
  let i = 0
  while (i < segs.length) {
    const seg = segs[i]
    if (seg.kind === 'text') {
      out.push(<MarkdownView key={`t${k++}`}>{seg.text}</MarkdownView>)
      i++
    } else if (isSearchSummary(seg.summary)) {
      // Coalesce a run of consecutive web-search cards into one group.
      const searches: { query: string; body?: string }[] = []
      while (i < segs.length) {
        const s = segs[i]
        if (s.kind === 'tool' && isSearchSummary(s.summary)) {
          searches.push({ query: searchQuery(s.summary), body: s.body })
          i++
        } else break
      }
      out.push(<SearchGroupCard key={`s${k++}`} searches={searches} />)
    } else {
      out.push(<ToolCard key={`c${k++}`} summary={seg.summary} body={seg.body} />)
      i++
    }
  }
  return out
}

// While a reply is still streaming, long raw URLs (especially Google-News
// redirect links) briefly appear before the model finishes the `](…)` and
// markdown collapses them into a named link. Replace any long bare URL with a
// tidy "🔗 hostname" chip for the streaming view only — the final render uses
// the stored message content, so the real links come back once the reply lands.
function collapseStreamingUrls(text: string): string {
  return text.replace(/https?:\/\/[^\s)<>]{28,}/g, (url) => {
    try {
      return `🔗 ${new URL(url).hostname.replace(/^www\./, '')}`
    } catch {
      return '🔗 link'
    }
  })
}

/** Strip ⟦tool⟧ sentinels to readable text (for copy / read-aloud / verify). */
function stripToolMarkers(s: string): string {
  return s.replace(/⟦tool⟧([\s\S]*?)⟦\/tool⟧/g, (_full, inner: string) => {
    const [summary, body] = inner.split('⟦body⟧')
    return body ? `${summary.trim()}\n${body.trim()}` : summary.trim()
  })
}

// ---------- Artifacts (split-screen preview of replies: HTML/SVG rendered,
// documents rendered, other code blocks shown as code) ----------

interface Artifact {
  lang: 'html' | 'svg' | 'code'
  code: string
  /** header label, e.g. "📄 report.docx" or the code language */
  title?: string
  /** source language of a 'code' artifact ("python", "ts", …) */
  language?: string
}

const FENCE_RE = /```(\w*)[^\S\n]*\r?\n([\s\S]*?)```/g
const MIN_CODE_LINES = 8 // shorter snippets stay inline in the reply

/** Find previewable blocks in a reply: HTML pages / SVG images / code. */
function extractArtifacts(content: string): Artifact[] {
  const out: Artifact[] = []
  for (const m of content.matchAll(FENCE_RE)) {
    const lang = (m[1] || '').toLowerCase()
    const code = m[2]
    const head = code.trimStart().slice(0, 200).toLowerCase()
    if (lang === 'svg' || head.startsWith('<svg')) {
      out.push({ lang: 'svg', code })
    } else if (
      lang === 'html' ||
      ((lang === '' || lang === 'xml') && (head.startsWith('<!doctype html') || head.startsWith('<html')))
    ) {
      out.push({ lang: 'html', code })
    } else if (code.split('\n').length >= MIN_CODE_LINES) {
      out.push({ lang: 'code', code, language: lang || undefined })
    }
  }
  return out
}

// Remember the last model list in the browser so the landing screen paints
// INSTANTLY on the next launch, instead of showing the "Add an API key…"
// placeholder for the second or two it takes the main process to return the
// (cached) list. First-ever run has nothing stored → placeholder shows once.
const MODELS_LS_KEY = 'orbit-models-cache'
function loadCachedModels(): ModelInfo[] {
  try {
    const raw = localStorage.getItem(MODELS_LS_KEY)
    return raw ? (JSON.parse(raw) as ModelInfo[]) : []
  } catch {
    return []
  }
}
function saveCachedModels(models: ModelInfo[]): void {
  try {
    localStorage.setItem(MODELS_LS_KEY, JSON.stringify(models))
  } catch {
    // best-effort; a full/blocked localStorage must never break the app
  }
}

export default function ChatsView({
  initialId,
  collapsed
}: {
  initialId?: string | null
  collapsed?: boolean
}) {
  const [metas, setMetas] = useState<ConversationMeta[]>([])
  // Seeded from the last session's list so the composer shows immediately.
  const [models, setModels] = useState<ModelInfo[]>(loadCachedModels)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [conv, setConv] = useState<Conversation | null>(null)
  // Multi-select delete
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Cross-chat search
  const [search, setSearch] = useState('')
  const [hits, setHits] = useState<ConversationSearchHit[]>([])
  // Prompt templates (reusable prompts inserted into the composer)
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  // Folders (organise chats)
  const [folders, setFolders] = useState<Folder[]>([])
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  // Cost & token dashboard toggle
  const [showCost, setShowCost] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [streamText, setStreamText] = useState<string | null>(null)
  const [streamReasoning, setStreamReasoning] = useState('')
  // Errors are kept PER conversation so leaving a chat and coming back still
  // shows the error that happened there (they used to vanish on navigation).
  // Cleared automatically when that chat next produces a successful reply.
  const [errors, setErrors] = useState<Record<string, string>>({})
  const setConvError = useCallback((convId: string, msg: string | null) => {
    setErrors((prev) => {
      if (msg == null) {
        if (!(convId in prev)) return prev
        const next = { ...prev }
        delete next[convId]
        return next
      }
      if (prev[convId] === msg) return prev
      return { ...prev, [convId]: msg }
    })
  }, [])
  const [showSystem, setShowSystem] = useState(false)
  const [toolRequests, setToolRequests] = useState<ToolRequestEvent[]>([])
  const [artifact, setArtifact] = useState<Artifact | null>(null)
  // Click any attachment (in the composer or a sent message) to preview it in a popup.
  const [previewAttachment, setPreviewAttachment] = useState<ChatAttachment | null>(null)
  const convRef = useRef<Conversation | null>(null)
  convRef.current = conv
  const autopilotOn = useBetaFlag('autopilot')
  // Live note about how the last autopilot message was routed (cleared per chat).
  const [routeNote, setRouteNote] = useState<string | null>(null)
  useEffect(() => setRouteNote(null), [conv?.id])
  // models via ref so the (stable) chat-event effect always reads the latest list
  const modelsRef = useRef<ModelInfo[]>(models)
  modelsRef.current = models

  // Autopilot must only route to models the user can ACTUALLY call — a provider
  // with a saved key, or a local one (Ollama) that needs none. Otherwise it would
  // happily pick e.g. Claude with no Anthropic key and the send would error.
  const usableProviderIds = useMemo(
    () => new Set(providers.filter((p) => p.hasKey || !p.needsKey).map((p) => p.id)),
    [providers]
  )
  const routableModels = useMemo(
    () => models.filter((m) => usableProviderIds.has(m.providerId)),
    [models, usableProviderIds]
  )
  // Fall back to the full list only before providers have loaded (empty set).
  const routable = routableModels.length > 0 ? routableModels : models
  const routableRef = useRef<ModelInfo[]>(routable)
  routableRef.current = routable

  // Autopilot resilience: if the model Autopilot picked errors (a bad tool call,
  // a quota/rate limit, etc.), silently retry the SAME message with another
  // usable model instead of dumping a red error on the user. Tracks which models
  // we've already tried for the in-flight message so we escalate, not loop.
  const autopilotRetryRef = useRef<{ convId: string; tried: Set<string>; count: number } | null>(null)
  const AUTOPILOT_MAX_FALLBACKS = 2

  const refreshMetas = useCallback(async () => {
    setMetas(await window.api.conversations.list())
  }, [])

  const refreshFolders = useCallback(async () => {
    setFolders(await window.api.folders.list())
  }, [])

  useEffect(() => {
    refreshMetas()
    refreshFolders()
    const pullModels = () =>
      Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) => {
        const merged = [...m, ...o.models]
        setModels(merged)
        saveCachedModels(merged)
      })
    pullModels()
    // Background usability probes trim the list moments after boot/refresh —
    // re-pull when main says it changed so unusable models visibly disappear.
    const offUpdated = window.api.models.onUpdated(() => void pullModels())
    window.api.providers.list().then(setProviders)
    window.api.prompts.list().then(setTemplates)
    return offUpdated
  }, [refreshMetas, refreshFolders])

  // Cross-chat search (debounced), re-run when the chat list changes
  useEffect(() => {
    const q = search.trim()
    if (!q) {
      setHits([])
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      window.api.conversations.search(q).then((r) => !cancelled && setHits(r))
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search, metas])

  // Opened from another view (e.g. "New chat in project"). The special
  // '__new__' signal means "show the empty landing composer" (Ctrl+N / palette /
  // command bar) without creating a throwaway conversation.
  useEffect(() => {
    if (initialId === '__new__') {
      setConv(null)
      setStreamText(null)
      setStreamReasoning('')
      setArtifact(null)
    } else if (initialId) {
      window.api.conversations.get(initialId).then(setConv)
      refreshMetas()
    }
  }, [initialId, refreshMetas])

  // Resolve project badge for project-linked conversations
  useEffect(() => {
    let cancelled = false
    if (conv?.projectId) {
      window.api.projects
        .get(conv.projectId)
        .then((p) => !cancelled && setProjectName(p.name))
        .catch(() => !cancelled && setProjectName(null))
    } else {
      setProjectName(null)
    }
    return () => {
      cancelled = true
    }
  }, [conv?.projectId])

  useEffect(() => {
    const offChunk = window.api.chat.onChunk((e) => {
      if (e.conversationId === convRef.current?.id) {
        if (e.reasoning) setStreamReasoning((prev) => prev + e.delta)
        else setStreamText((prev) => (prev ?? '') + e.delta)
      }
    })
    const offDone = window.api.chat.onDone(async (e) => {
      if (e.conversationId === convRef.current?.id) {
        // Autopilot: bank the savings vs sending this to the priciest model.
        if (convRef.current?.autopilot && e.message.usage && e.message.model) {
          const priciest = priciestModel(routableRef.current)
          const [mp, ...mr] = e.message.model.split('/')
          const inTok = e.message.usage.inputTokens ?? 0
          const outTok = e.message.usage.outputTokens ?? 0
          if (priciest) {
            const baseline = estimateCost(priciest.providerId, priciest.modelId, inTok, outTok)
            const actual = estimateCost(mp, mr.join('/'), inTok, outTok)
            if (baseline != null && actual != null) addAutopilotSavings(baseline - actual)
          }
        }
        setConv(await window.api.conversations.get(e.conversationId))
        setStreamText(null)
        setStreamReasoning('')
        // a successful reply clears any earlier error shown for this chat
        setConvError(e.conversationId, null)
        // auto-open the artifact panel when the reply contains something
        // previewable — but never clobber a just-created document preview
        const found = extractArtifacts(e.message.content)
        if (found.length > 0) {
          setArtifact((prev) => (prev?.title?.startsWith('📄') ? prev : found[found.length - 1]))
        }
      }
      refreshMetas()
    })
    const offError = window.api.chat.onError((e) => {
      // Autopilot self-heal: if the routed model failed, try another usable
      // model for the same message before surfacing any error.
      const retry = autopilotRetryRef.current
      // With web search on, each retry re-runs the whole (slow) search turn, so
      // cap retries to ONE and recover with a FAST model — retrying across
      // several big/slow models is what turned one answer into a 10-minute wait.
      const webOn = convRef.current?.webSearch ?? false
      const maxFallbacks = webOn ? 1 : AUTOPILOT_MAX_FALLBACKS
      if (
        retry &&
        retry.convId === e.conversationId &&
        convRef.current?.id === e.conversationId &&
        convRef.current?.autopilot &&
        retry.count < maxFallbacks
      ) {
        const list = routableRef.current
        // Recover with a fast model first (quick retry). Only fall back to the
        // priciest model when web search is off and speed matters less.
        const preferred = webOn ? fastModel(list) : priciestModel(list)
        const fallback =
          preferred && !retry.tried.has(preferred.id)
            ? preferred
            : list.find((m) => !retry.tried.has(m.id))
        if (fallback) {
          retry.tried.add(fallback.id)
          retry.count += 1
          setRouteNote(`⚡ Autopilot · retrying with ${fallback.label}`)
          setConvError(e.conversationId, null)
          setStreamReasoning('')
          setStreamText('')
          window.api.chat.regenerate(e.conversationId, {
            providerId: fallback.providerId,
            modelId: fallback.modelId
          })
          return
        }
      }
      // Store the error against its conversation (so it survives navigating
      // away and back); only touch the live stream state for the open chat.
      setConvError(e.conversationId, e.message)
      if (e.conversationId === convRef.current?.id) {
        setStreamText(null)
        setStreamReasoning('')
      }
    })
    const offTool = window.api.chat.onToolRequest((e) => {
      setToolRequests((prev) => [...prev, e])
    })
    // create_document saved a file → show the rendered document split-screen
    const offDoc = window.api.chat.onDocumentPreview((e) => {
      if (e.conversationId === convRef.current?.id) {
        setArtifact({ lang: 'html', code: e.html, title: `📄 ${e.filename}.${e.format}` })
      }
    })
    return () => {
      offChunk()
      offDone()
      offError()
      offTool()
      offDoc()
    }
  }, [refreshMetas, setConvError])

  const respondTool = (requestId: string, decision: 'allow' | 'always' | 'deny') => {
    window.api.chat.respondTool(requestId, decision)
    setToolRequests((prev) => prev.filter((r) => r.requestId !== requestId))
  }

  const defaultModel = useMemo(() => pickDefaultModel(models), [models])

  // Model chosen on the landing screen (defaults to the last-used model).
  // Also self-heals: the seeded list can briefly contain models that the
  // usability check has since hidden (e.g. a provider whose key stopped
  // working) — if the chosen model vanishes from the list, snap to one that
  // actually exists so new chats never start on a dead model.
  const [landingModelId, setLandingModelId] = useState('')
  // Web search / thinking chosen on the landing screen, applied to the new chat.
  const [landingWeb, setLandingWeb] = useState(false)
  const [landingEffort, setLandingEffort] = useState<Effort>('off')
  useEffect(() => {
    if (!defaultModel) return
    // Autopilot is a valid choice even though it isn't a concrete model in the
    // list — without this exception, selecting it was instantly reset back to a
    // real model, so landing-page Autopilot "did nothing".
    if (landingModelId === AUTOPILOT_ID) return
    if (!landingModelId || !models.some((m) => m.id === landingModelId)) {
      setLandingModelId(defaultModel.id)
    }
  }, [defaultModel, landingModelId, models])

  // Does the model currently picked on the landing screen support a thinking
  // mode? (Autopilot is treated as thinking-capable — it may route to one.)
  const landingCanThink = useMemo(() => {
    if (landingModelId === AUTOPILOT_ID) return true
    const [pid, ...rest] = (landingModelId || defaultModel?.id || '').split('/')
    const kind = providers.find((p) => p.id === pid)?.kind
    return supportsThinking(kind, rest.join('/'))
  }, [landingModelId, defaultModel, providers])

  // Landing composer: start a brand-new chat from the empty state and send the
  // first message immediately (Claude-desktop style "how can I help" box).
  const startChat = async (text: string, attachments: ChatAttachment[]) => {
    const id = landingModelId || defaultModel?.id
    if (!id) return
    const isAuto = id === AUTOPILOT_ID
    // Autopilot has no concrete model of its own — seed the chat on the best
    // available model and flip the autopilot flag on.
    const concrete = isAuto ? bestModel(routableRef.current)?.id ?? defaultModel?.id : id
    if (!concrete) return
    const [providerId, ...rest] = concrete.split('/')
    let c = await window.api.conversations.create(providerId, rest.join('/'))
    // Carry the landing toggles onto the new conversation.
    const patch: Record<string, unknown> = {}
    if (isAuto) patch.autopilot = true
    if (landingWeb) patch.webSearch = true
    if (landingEffort !== 'off' && landingCanThink) {
      patch.thinking = true
      patch.effort = landingEffort
    }
    if (Object.keys(patch).length > 0) c = await window.api.conversations.update(c.id, patch)
    if (!isAuto) setLastModel(id)
    setConvError(c.id, null)
    setStreamReasoning('')
    setConv({
      ...c,
      messages: [{ role: 'user', content: text, attachments: attachments.length ? attachments : undefined }]
    })
    setStreamText('')
    // For an Autopilot first message, route it the same way send() would.
    let modelOverride: { providerId: string; modelId: string } | undefined
    if (isAuto) {
      const difficulty = heuristicDifficulty(text, 0)
      const target = routeModel(difficulty, routableRef.current)
      if (target) {
        modelOverride = { providerId: target.providerId, modelId: target.modelId }
        setRouteNote(`⚡ Autopilot · ${difficulty} → ${target.label}`)
        autopilotRetryRef.current = { convId: c.id, tried: new Set([target.id]), count: 0 }
      }
    }
    window.api.chat.send(c.id, text, attachments.length ? attachments : undefined, modelOverride)
    refreshMetas()
  }

  // "New chat" shows the empty landing composer instead of eagerly creating a
  // conversation. The real conversation is created only when the first message
  // is sent (startChat), so an unused new chat never clutters the history list.
  const newChat = () => {
    setConv(null)
    setStreamText(null)
    setStreamReasoning('')
    setArtifact(null)
  }

  const select = async (id: string) => {
    setConv(await window.api.conversations.get(id))
    setStreamText(null)
    setArtifact(null)
  }

  const remove = async (id: string) => {
    const title = metas.find((m) => m.id === id)?.title || 'this chat'
    const ok = await confirmDialog(`Delete “${title}”?`, {
      detail: 'This permanently removes the conversation and cannot be undone.',
      confirmLabel: 'Delete'
    })
    if (!ok) return
    await window.api.conversations.delete(id)
    if (conv?.id === id) setConv(null)
    refreshMetas()
  }

  // ---- rename / pin / move to folder ----
  const renameChat = async (id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    await window.api.conversations.update(id, { title: t })
    if (conv?.id === id) setConv((c) => (c ? { ...c, title: t } : c))
    refreshMetas()
  }
  const setPinned = async (id: string, pinned: boolean) => {
    await window.api.conversations.update(id, { pinned })
    refreshMetas()
  }
  const moveToFolder = async (id: string, folderId: string | undefined) => {
    await window.api.conversations.update(id, { folderId })
    refreshMetas()
  }

  // ---- folder management ----
  const createFolder = async (name: string) => {
    const n = name.trim()
    if (!n) return
    await window.api.folders.create(n)
    setNewFolderOpen(false)
    refreshFolders()
  }
  const renameFolder = async (id: string, name: string) => {
    if (!name.trim()) return
    setFolders(await window.api.folders.rename(id, name.trim()))
  }
  const deleteFolder = async (id: string) => {
    const name = folders.find((f) => f.id === id)?.name || 'this folder'
    const ok = await confirmDialog(`Delete folder “${name}”?`, {
      detail: 'The folder is removed; the chats inside it are kept and become unfiled.',
      confirmLabel: 'Delete folder'
    })
    if (!ok) return
    setFolders(await window.api.folders.delete(id))
    refreshMetas()
  }

  // ---- edit a past user message and re-run / regenerate with another model ----
  const editResend = (index: number, newText: string) => {
    if (!conv) return
    setConvError(conv.id, null)
    setStreamReasoning('')
    setConv({
      ...conv,
      messages: [...conv.messages.slice(0, index), { ...conv.messages[index], content: newText }]
    })
    setStreamText('')
    window.api.chat.editResend(conv.id, index, newText)
  }
  const regenerateWithModel = async (modelId: string) => {
    if (!conv) return
    setLastModel(modelId)
    const [providerId, ...rest] = modelId.split('/')
    setConvError(conv.id, null)
    setStreamReasoning('')
    setConv({
      ...conv,
      providerId,
      modelId: rest.join('/'),
      messages:
        conv.messages.at(-1)?.role === 'assistant' ? conv.messages.slice(0, -1) : conv.messages
    })
    setStreamText('')
    window.api.chat.regenerate(conv.id, { providerId, modelId: rest.join('/') })
  }

  // ---- multi-select delete ----
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const exitSelect = () => {
    setSelectMode(false)
    setSelected(new Set())
  }

  const allSelected = metas.length > 0 && selected.size === metas.length
  const toggleSelectAll = () =>
    setSelected(allSelected ? new Set() : new Set(metas.map((m) => m.id)))

  const deleteSelected = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    const ok = await confirmDialog(`Delete ${ids.length} chat${ids.length > 1 ? 's' : ''}?`, {
      detail: 'This permanently removes the selected conversations.',
      confirmLabel: 'Delete'
    })
    if (!ok) return
    await window.api.conversations.deleteMany(ids)
    if (conv && ids.includes(conv.id)) setConv(null)
    exitSelect()
    refreshMetas()
  }

  const deleteAll = async () => {
    if (metas.length === 0) return
    const ok = await confirmDialog(`Delete all ${metas.length} chats?`, {
      detail: 'This permanently removes every conversation and cannot be undone.',
      confirmLabel: 'Delete all'
    })
    if (!ok) return
    await window.api.conversations.deleteAll()
    setConv(null)
    exitSelect()
    refreshMetas()
  }

  const send = async (text: string, attachments: ChatAttachment[]) => {
    if (!conv) return
    setConvError(conv.id, null)
    setStreamReasoning('')
    setRouteNote(null)
    setConv({
      ...conv,
      messages: [
        ...conv.messages,
        { role: 'user', content: text, attachments: attachments.length ? attachments : undefined }
      ]
    })
    setStreamText('')

    // Autopilot: classify this message and route it to a suitable model.
    let modelOverride: { providerId: string; modelId: string } | undefined
    autopilotRetryRef.current = null
    if (conv.autopilot) {
      let difficulty: Difficulty = heuristicDifficulty(text, conv.messages.length)
      const settings = getAutopilotSettings()
      if (settings.useClassifier) {
        const cid = settings.classifierId || defaultClassifier(routable)?.id
        if (cid) {
          const [cp, ...cr] = cid.split('/')
          try {
            const refined = await window.api.chat.classify(cp, cr.join('/'), text)
            if (refined) difficulty = refined
          } catch {
            // fall back to the heuristic label
          }
        }
      }
      const target = routeModel(difficulty, routable)
      if (target) {
        modelOverride = { providerId: target.providerId, modelId: target.modelId }
        setRouteNote(`⚡ Autopilot · ${difficulty} → ${target.label}`)
        autopilotRetryRef.current = { convId: conv.id, tried: new Set([target.id]), count: 0 }
      }
    }

    window.api.chat.send(conv.id, text, attachments.length ? attachments : undefined, modelOverride)
  }

  const stop = () => conv && window.api.chat.stop(conv.id)

  const regenerate = () => {
    if (!conv) return
    setConvError(conv.id, null)
    setStreamReasoning('')
    setConv({
      ...conv,
      messages:
        conv.messages.at(-1)?.role === 'assistant' ? conv.messages.slice(0, -1) : conv.messages
    })
    setStreamText('')
    window.api.chat.regenerate(conv.id)
  }

  const setModel = async (value: string) => {
    if (!conv) return
    if (value === AUTOPILOT_ID) {
      // Turn Autopilot on; keep the current concrete model as the fallback.
      setRouteNote(null)
      setConv(await window.api.conversations.update(conv.id, { autopilot: true }))
      return
    }
    setLastModel(value) // new chats will default to this model
    const [providerId, ...rest] = value.split('/')
    setConv(
      await window.api.conversations.update(conv.id, {
        autopilot: false,
        providerId,
        modelId: rest.join('/')
      })
    )
  }

  const saveSystemPrompt = async (systemPrompt: string) => {
    if (!conv) return
    setConv(await window.api.conversations.update(conv.id, { systemPrompt }))
  }

  const streaming = streamText !== null
  // The error to show for the currently open chat (kept per-conversation).
  const error = conv ? errors[conv.id] ?? null : null

  // If an open chat is pinned to a model that no longer exists in the picker
  // (hidden by the usability check, key removed, provider gone), move it to a
  // model that works instead of letting every send fail with a red error.
  useEffect(() => {
    if (!conv || conv.autopilot || streaming || models.length === 0) return
    const id = `${conv.providerId}/${conv.modelId}`
    if (models.some((m) => m.id === id)) return
    const fallback = pickDefaultModel(models)
    if (fallback) void setModel(fallback.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setModel recreated each render; keying on conv identity + models
  }, [conv?.id, conv?.providerId, conv?.modelId, conv?.autopilot, models, streaming])
  const searching = search.trim().length > 0

  const activeModel = conv
    ? models.find((m) => m.id === `${conv.providerId}/${conv.modelId}`)
    : undefined
  const activeKind = conv ? providers.find((p) => p.id === conv.providerId)?.kind : undefined
  const canThink = conv ? supportsThinking(activeKind, conv.modelId) : false
  const contextTokens = useMemo(() => (conv ? computeContextTokens(conv) : 0), [conv])
  const contextPct = activeModel ? (contextTokens / activeModel.contextWindow) * 100 : null

  // The toolbar picker gets a virtual "Autopilot" option pinned at the top when
  // the beta feature is on.
  const pickerModels = useMemo<ModelInfo[]>(() => {
    if (!autopilotOn) return models
    return [
      {
        id: AUTOPILOT_ID,
        providerId: 'autopilot',
        modelId: 'auto',
        label: 'Autopilot',
        contextWindow: activeModel?.contextWindow ?? 128_000,
        builtin: true
      },
      ...models
    ]
  }, [autopilotOn, models, activeModel])

  return (
    <div className="chats">
      <div className={`chat-list ${collapsed ? 'collapsed' : ''}`}>
        <button className="new-chat icon-btn" onClick={newChat} disabled={!defaultModel}>
          <PlusIcon /> New chat
        </button>
        <div className="chat-search">
          <SearchIcon />
          <input
            placeholder="Search all chats…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="chip-remove" title="Clear search" onClick={() => setSearch('')}>
              <CloseIcon />
            </button>
          )}
        </div>
        {!searching && metas.length > 0 && (
          <div className="chat-list-tools">
            {selectMode ? (
              <>
                <button className="ghost small" onClick={toggleSelectAll}>
                  {allSelected ? 'Clear' : 'All'}
                </button>
                <div className="composer-spacer" />
                <button
                  className="ghost small danger icon-btn"
                  disabled={selected.size === 0}
                  onClick={deleteSelected}
                >
                  <TrashIcon /> Delete ({selected.size})
                </button>
                <button className="ghost small" onClick={exitSelect}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <button className="ghost small" onClick={() => setSelectMode(true)}>
                  Select
                </button>
                <button className="ghost small icon-btn" onClick={() => setNewFolderOpen((o) => !o)} title="Create a folder">
                  <FolderPlusInline /> Folder
                </button>
                <button className="ghost small danger" onClick={deleteAll} title="Delete every chat">
                  Delete all
                </button>
              </>
            )}
          </div>
        )}
        {newFolderOpen && !searching && (
          <NewFolderInput onCreate={createFolder} onCancel={() => setNewFolderOpen(false)} />
        )}
        {searching
          ? (hits.length === 0 ? (
              <div className="card-sub" style={{ padding: '8px 10px' }}>
                No chats match “{search.trim()}”.
              </div>
            ) : (
              hits.map((h) => (
                <div
                  key={h.id}
                  className={`chat-item search-hit ${conv?.id === h.id ? 'active' : ''}`}
                  onClick={() => select(h.id)}
                >
                  <div className="search-hit-body">
                    <span className="chat-item-title">{h.title}</span>
                    {h.snippet && <span className="search-hit-snippet">{h.snippet}</span>}
                  </div>
                </div>
              ))
            ))
          : selectMode
            ? metas.map((m) => (
                <div
                  key={m.id}
                  className={`chat-item ${selected.has(m.id) ? 'checked' : ''}`}
                  onClick={() => toggleSelected(m.id)}
                >
                  <input type="checkbox" className="chat-check" checked={selected.has(m.id)} readOnly />
                  <span className="chat-item-title">{m.title}</span>
                </div>
              ))
            : (
                <ChatGroups
                  metas={metas}
                  folders={folders}
                  activeId={conv?.id ?? null}
                  onSelect={select}
                  onRename={renameChat}
                  onPin={setPinned}
                  onMove={moveToFolder}
                  onDelete={remove}
                  onRenameFolder={renameFolder}
                  onDeleteFolder={deleteFolder}
                />
              )}
      </div>

      {!conv ? (
        models.length === 0 ? (
          <div className="placeholder">
            <h1>Chats</h1>
            <p>Add an API key in Providers (or start Ollama) to begin.</p>
          </div>
        ) : (
          <div className="chat-landing">
            <div className="chat-landing-inner">
              <div className="landing-hero">
                <h1>How can I help you today?</h1>
                <p>Start a conversation with any model — switch anytime.</p>
              </div>
              <LandingComposer
                models={pickerModels}
                modelValue={landingModelId || `${defaultModel?.providerId}/${defaultModel?.modelId}`}
                onModelChange={(v) => {
                  setLandingModelId(v)
                  if (v !== AUTOPILOT_ID) setLastModel(v)
                }}
                webSearch={landingWeb}
                onToggleWebSearch={() => setLandingWeb((w) => !w)}
                canThink={landingCanThink}
                effort={landingEffort}
                onEffort={setLandingEffort}
                onSend={startChat}
                onOpenAttachment={setPreviewAttachment}
              />
            </div>
          </div>
        )
      ) : (
        <div className="chat-main">
          <div className="chat-toolbar">
            <ModelSelect
              models={pickerModels}
              value={conv.autopilot ? AUTOPILOT_ID : `${conv.providerId}/${conv.modelId}`}
              onChange={setModel}
              disabled={streaming}
            />
            {conv.autopilot && (
              <span className="autopilot-tag" title="Autopilot routes each message to a suitable model automatically.">
                ⚡ Autopilot
              </span>
            )}
            <button className="ghost" onClick={() => setShowSystem((s) => !s)}>
              System prompt {conv.systemPrompt ? '●' : ''}
            </button>
            {canThink && (
              <ThinkingSelect
                disabled={streaming}
                value={conv.thinking ? conv.effort ?? 'medium' : 'off'}
                onChange={async (v) => {
                  setConv(
                    await window.api.conversations.update(
                      conv.id,
                      v === 'off' ? { thinking: false } : { thinking: true, effort: v }
                    )
                  )
                }}
              />
            )}
            <button
              className={`ghost icon-btn ${conv.webSearch ? 'thinking-on' : ''}`}
              disabled={streaming}
              title="Web search: lets the model look things up on the web (works with models that support tools). Results are fetched by the app — no API key needed."
              onClick={async () =>
                setConv(await window.api.conversations.update(conv.id, { webSearch: !conv.webSearch }))
              }
            >
              <GlobeIcon /> Web {conv.webSearch ? 'on' : 'off'}
            </button>
            <button
              className={`ghost icon-btn ${showCost ? 'thinking-on' : ''}`}
              title="Cost & token usage for this chat"
              onClick={() => setShowCost((s) => !s)}
            >
              <CoinIcon /> Cost
            </button>
            {projectName && <span className="badge">📁 {projectName}</span>}
            <div
              className={`token-counter ${contextPct !== null && contextPct > 80 ? 'warn' : ''}`}
              title="Context window usage: exact provider-reported tokens for past turns, estimated (~4 chars/token) for text not yet sent"
            >
              <span>
                {formatTokens(contextTokens)} tokens
                {contextPct !== null &&
                  ` · ${contextPct < 0.1 && contextTokens > 0 ? '<0.1' : contextPct.toFixed(1)}% of ${formatTokens(activeModel!.contextWindow)}`}
              </span>
              {contextPct !== null && (
                <div className="token-bar">
                  <div
                    className="token-bar-fill"
                    style={{ width: `${Math.min(100, Math.max(contextTokens > 0 ? 1 : 0, contextPct))}%` }}
                  />
                </div>
              )}
            </div>
          </div>
          {showCost && <CostPanel conv={conv} onClose={() => setShowCost(false)} />}
          {contextPct !== null && contextPct > 80 && (
            <div className="chat-warning">
              ⚠ This conversation is at {contextPct.toFixed(0)}% of the model's context window —
              older messages may soon be cut off. Consider starting a new chat.
            </div>
          )}
          {showSystem && (
            <textarea
              className="system-prompt"
              placeholder="System prompt for this conversation (optional)…"
              defaultValue={conv.systemPrompt}
              onBlur={(e) => saveSystemPrompt(e.target.value)}
              rows={3}
            />
          )}

          <Messages
            conv={conv}
            models={models}
            streaming={streaming}
            streamText={streamText}
            streamReasoning={streamReasoning}
            onPreview={setArtifact}
            onEditResend={editResend}
            onRegenerateWithModel={regenerateWithModel}
            onOpenAttachment={setPreviewAttachment}
          />

          {error && (
            <div className="chat-error">
              ⚠{' '}
              {/rate.?limit|too many requests|resource[_ ]?exhausted|quota|tokens per minute|\bTPM\b|request too large|reduce your message size|\b429\b/i.test(error)
                ? 'This model is rate-limited or the request is too large for its free-tier per-minute limit. Wait a minute and retry, start a new chat to shrink the context, or switch to another model.'
                : error}
              <button className="ghost small" onClick={regenerate}>
                ↻ Retry
              </button>
            </div>
          )}

          {toolRequests
            .filter((r) => r.conversationId === conv.id)
            .slice(0, 1)
            .map((r) => (
              <div key={r.requestId} className="tool-approval">
                <div className="tool-approval-text">
                  🔧 The model wants to run <strong>{r.toolName}</strong> from{' '}
                  <strong>{r.serverName}</strong>
                  <code className="tool-args">{JSON.stringify(r.args)}</code>
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

          {conv.autopilot && routeNote && <div className="autopilot-route">{routeNote}</div>}
          <Composer
            streaming={streaming}
            canRegenerate={!streaming && conv.messages.at(-1)?.role === 'assistant'}
            templates={templates}
            costProviderId={conv.providerId}
            costModelId={conv.modelId}
            contextTokens={contextTokens}
            onSend={send}
            onStop={stop}
            onRegenerate={regenerate}
            onOpenAttachment={setPreviewAttachment}
          />
        </div>
      )}
      {conv && artifact && <ArtifactPanel artifact={artifact} onClose={() => setArtifact(null)} />}
      {previewAttachment && (
        <AttachmentModal attachment={previewAttachment} onClose={() => setPreviewAttachment(null)} />
      )}
    </div>
  )
}

/** Popup preview of an attached file (image shown full-size; documents show
 *  their extracted text). Same modal pattern as Settings. */
function AttachmentModal({
  attachment,
  onClose
}: {
  attachment: ChatAttachment
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal attach-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="attach-modal-head">
          <span className="attach-modal-title">
            {attachment.image ? '🖼' : '📄'} {attachment.name}
          </span>
          <div className="composer-spacer" />
          <button className="ghost small" onClick={onClose} title="Close (Esc)">
            ✕
          </button>
        </div>
        <div className="attach-modal-body">
          {attachment.image ? (
            <img className="attach-modal-img" src={attachment.image} alt={attachment.name} />
          ) : attachment.text && attachment.text.trim() ? (
            <pre className="attach-modal-text">{attachment.text}</pre>
          ) : (
            <div className="card-sub">No preview available for this file.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function ArtifactPanel({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const codeOnly = artifact.lang === 'code'
  const [tab, setTab] = useState<'preview' | 'code'>(codeOnly ? 'code' : 'preview')
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  // Resizable width (drag the left edge). Persisted across sessions.
  const [width, setWidth] = useState(
    () => Number(localStorage.getItem('orbit-artifact-width')) || Math.round(window.innerWidth * 0.44)
  )
  const [dragging, setDragging] = useState(false)

  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    setDragging(true)
    const onMove = (ev: MouseEvent) => {
      const w = Math.min(Math.max(window.innerWidth - ev.clientX, 340), window.innerWidth - 420)
      setWidth(w)
    }
    const onUp = () => {
      setDragging(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setWidth((w) => {
        localStorage.setItem('orbit-artifact-width', String(w))
        return w
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    setTab(artifact.lang === 'code' ? 'code' : 'preview')
    setUrl(null)
    setCopied(false)
    if (artifact.lang === 'code') return // nothing to render in an iframe
    const html =
      artifact.lang === 'svg'
        ? `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}</style></head><body>${artifact.code}</body></html>`
        : artifact.code
    let cancelled = false
    window.api.chat.setArtifact(html).then((u) => !cancelled && setUrl(u))
    return () => {
      cancelled = true
    }
  }, [artifact])

  const copy = async () => {
    await navigator.clipboard.writeText(artifact.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const saveName =
    artifact.lang === 'svg'
      ? 'artifact.svg'
      : artifact.lang === 'html'
        ? 'artifact.html'
        : `code.${/^[a-z0-9]{1,10}$/.test(artifact.language ?? '') ? artifact.language : 'txt'}`
  const save = () => window.api.chat.exportText(artifact.code, saveName)

  const defaultTitle =
    artifact.lang === 'svg' ? '🖼 SVG preview' : artifact.lang === 'html' ? '🌐 Web preview' : `⌨ ${artifact.language ?? 'code'}`

  return (
    <div className="artifact-panel" style={{ width }}>
      <div className="artifact-resizer" onMouseDown={startDrag} title="Drag to resize" />
      {/* transparent overlay so the drag isn't swallowed by the preview iframe */}
      {dragging && <div className="drag-overlay" />}
      <div className="artifact-head">
        <span className="artifact-title">{artifact.title ?? defaultTitle}</span>
        {!codeOnly && (
          <>
            <button
              className={`ghost small ${tab === 'preview' ? 'tab-active' : ''}`}
              onClick={() => setTab('preview')}
            >
              Preview
            </button>
            <button
              className={`ghost small ${tab === 'code' ? 'tab-active' : ''}`}
              onClick={() => setTab('code')}
            >
              Code
            </button>
          </>
        )}
        <div className="composer-spacer" />
        <button className="ghost small" onClick={copy}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
        <button className="ghost small" onClick={save} title="Save to a file">
          ⬇ Save
        </button>
        <button className="ghost small" onClick={onClose} title="Close the preview panel">
          ✕
        </button>
      </div>
      {tab === 'preview' ? (
        url ? (
          <iframe className="artifact-frame" src={url} sandbox="allow-scripts" title="Artifact preview" />
        ) : (
          <div className="artifact-loading">Loading preview…</div>
        )
      ) : (
        <pre className="artifact-code">
          <code>{artifact.code}</code>
        </pre>
      )}
    </div>
  )
}

function Messages({
  conv,
  models,
  streaming,
  streamText,
  streamReasoning,
  onPreview,
  onEditResend,
  onRegenerateWithModel,
  onOpenAttachment
}: {
  conv: Conversation
  models: ModelInfo[]
  streaming: boolean
  streamText: string | null
  streamReasoning: string
  onPreview: (a: Artifact) => void
  onEditResend: (index: number, newText: string) => void
  onRegenerateWithModel: (modelId: string) => void
  onOpenAttachment: (a: ChatAttachment) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // Stick-to-bottom: follow the stream ONLY while the user is already near the
  // bottom. The moment they scroll up to read, we stop yanking them back down
  // (matches Claude/ChatGPT). Direct scrollTop (no smooth animation) keeps the
  // follow crisp instead of the laggy scrollIntoView-on-every-chunk it replaced.
  const stickRef = useRef(true)
  const onMessagesScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }, [])
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [editText, setEditText] = useState('')
  const [regenIdx, setRegenIdx] = useState<number | null>(null)
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const [speakingIdx, setSpeakingIdx] = useState<number | null>(null)
  const [verify, setVerify] = useState<Record<number, { loading: boolean; report?: VerifyReport }>>({})

  // A brand-new message (or switching chats) always snaps to the bottom.
  useEffect(() => {
    stickRef.current = true
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [conv.messages.length, conv.id])

  // Streaming deltas only follow the bottom when the user hasn't scrolled up.
  useEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [streamText, streamReasoning])

  // Stop any narration when the conversation changes or the view unmounts.
  useEffect(() => {
    return () => window.speechSynthesis?.cancel()
  }, [conv.id])

  const copy = (i: number, text: string) => {
    navigator.clipboard.writeText(stripToolMarkers(text))
    setCopiedIdx(i)
    setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500)
  }
  const speak = (i: number, text: string) => {
    const synth = window.speechSynthesis
    if (!synth) return
    if (speakingIdx === i) {
      synth.cancel()
      setSpeakingIdx(null)
      return
    }
    synth.cancel()
    const u = new SpeechSynthesisUtterance(
      stripToolMarkers(text)
        .replace(/[#*`_>~[\]()]/g, '')
        .slice(0, 8000)
    )
    u.onend = () => setSpeakingIdx((s) => (s === i ? null : s))
    setSpeakingIdx(i)
    synth.speak(u)
  }
  const startEdit = (i: number, text: string) => {
    setEditingIdx(i)
    setEditText(text)
  }
  // Fact-check an assistant reply for hallucinations. Uses the conversation's
  // model as the verifier and grounds the check with a live web search.
  const runVerify = async (i: number) => {
    const answer = stripToolMarkers(conv.messages[i]?.content ?? '')
    let question = ''
    for (let j = i - 1; j >= 0; j--) {
      if (conv.messages[j].role === 'user') {
        question = conv.messages[j].content
        break
      }
    }
    setVerify((v) => ({ ...v, [i]: { loading: true, report: v[i]?.report } }))
    const report = await window.api.chat.verify({
      providerId: conv.providerId,
      modelId: conv.modelId,
      question,
      answer,
      useWeb: true
    })
    setVerify((v) => ({ ...v, [i]: { loading: false, report } }))
  }
  const lastAssistantIdx = (() => {
    for (let i = conv.messages.length - 1; i >= 0; i--) if (conv.messages[i].role === 'assistant') return i
    return -1
  })()

  // Web search on a small/"fast" model tends to return thin results. Suggest a
  // stronger model for research once, under the latest reply (issue #10).
  const searchRec = useMemo(() => {
    if (!conv.webSearch || classifyModel(conv.modelId) !== 'fast') return null
    const better = models
      .filter((m) => classifyModel(m.modelId) !== 'fast' && m.id !== `${conv.providerId}/${conv.modelId}`)
      .sort((a, b) => b.contextWindow - a.contextWindow)
    // Prefer a reasoning model, else the biggest-context capable one.
    const pick = better.find((m) => classifyModel(m.modelId) === 'thinking') ?? better[0]
    return pick?.label ?? null
  }, [conv.webSearch, conv.modelId, conv.providerId, models])

  return (
    <div className="chat-messages" ref={scrollRef} onScroll={onMessagesScroll}>
      {conv.messages.map((m, i) => (
        <div key={i} className={`msg msg-${m.role}`}>
          {m.role === 'user' ? (
            <div className="msg-user-wrap">
              {editingIdx === i ? (
                <div className="msg-edit">
                  <textarea
                    value={editText}
                    autoFocus
                    onChange={(e) => setEditText(e.target.value)}
                    rows={Math.min(10, Math.max(2, editText.split('\n').length))}
                  />
                  <div className="composer-actions">
                    <div className="composer-spacer" />
                    <button className="ghost small" onClick={() => setEditingIdx(null)}>
                      Cancel
                    </button>
                    <button
                      className="small"
                      disabled={!editText.trim() || streaming}
                      onClick={() => {
                        onEditResend(i, editText.trim())
                        setEditingIdx(null)
                      }}
                    >
                      Save &amp; resend
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="msg-bubble">
                    {m.content}
                    {m.attachments && m.attachments.length > 0 && (
                      <div className="attach-chips">
                        {m.attachments.map((a, j) =>
                          a.image ? (
                            <img
                              key={j}
                              className="attach-thumb"
                              src={a.image}
                              alt={a.name}
                              title="Click to preview"
                              onClick={() => onOpenAttachment(a)}
                            />
                          ) : (
                            <button
                              key={j}
                              className="attach-chip attach-chip-btn"
                              title="Click to preview"
                              onClick={() => onOpenAttachment(a)}
                            >
                              📎 {a.name}
                            </button>
                          )
                        )}
                      </div>
                    )}
                  </div>
                  <div className="msg-actions user-actions">
                    <button className="ghost small icon-btn" title="Copy" onClick={() => copy(i, m.content)}>
                      <CopyIcon /> {copiedIdx === i ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      className="ghost small icon-btn"
                      title="Edit this message and re-run the conversation from here"
                      disabled={streaming}
                      onClick={() => startEdit(i, m.content)}
                    >
                      <EditIcon /> Edit
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="msg-body markdown">
              <AssistantIdentity model={m.model} />
              {m.reasoning && (
                <details className="thinking-block">
                  <summary>Thinking</summary>
                  <div className="thinking-text">{m.reasoning}</div>
                </details>
              )}
              {renderReply(m.content)}
              {m.aborted && <div className="msg-note">stopped</div>}
              {i === lastAssistantIdx && searchRec && (
                <div className="search-model-note" title="Larger models generally search and synthesise the web more thoroughly.">
                  💡 For deeper web research, a stronger model like <strong>{searchRec}</strong> usually
                  returns fuller results.
                </div>
              )}
              <div className="msg-meta">
                {m.usage && (m.usage.inputTokens != null || m.usage.outputTokens != null) && (
                  <span>
                    {formatTokens(m.usage.inputTokens ?? 0)} in · {formatTokens(m.usage.outputTokens ?? 0)} out
                    {m.tps ? ` · ${m.tps} tok/s` : ''}
                    {m.model ? ` · ${m.model.split('/').pop()}` : ''}
                  </span>
                )}
                <span className="msg-actions">
                  <button className="ghost small icon-btn" title="Copy reply" onClick={() => copy(i, m.content)}>
                    <CopyIcon /> {copiedIdx === i ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    className={`ghost small icon-btn ${speakingIdx === i ? 'thinking-on' : ''}`}
                    title={speakingIdx === i ? 'Stop reading' : 'Read aloud'}
                    onClick={() => speak(i, m.content)}
                  >
                    <SpeakerIcon /> {speakingIdx === i ? 'Stop' : 'Read'}
                  </button>
                  {i === lastAssistantIdx && (
                    <button
                      className="ghost small icon-btn"
                      title="Regenerate this reply with a different model (second opinion)"
                      disabled={streaming}
                      onClick={() => setRegenIdx((r) => (r === i ? null : i))}
                    >
                      <RefreshIcon /> Other model
                    </button>
                  )}
                  <button
                    className={`ghost small icon-btn verify-btn ${verify[i]?.loading ? 'thinking-on' : ''}`}
                    title="Fact-check this reply for hallucinations (runs a live web search to verify the claims)"
                    disabled={verify[i]?.loading}
                    onClick={() => runVerify(i)}
                  >
                    🔍 {verify[i]?.loading ? 'Checking…' : verify[i]?.report ? 'Re-check' : 'Verify'}
                  </button>
                  {extractArtifacts(m.content).map((a, k) => (
                    <button
                      key={k}
                      className="ghost small"
                      title="Open this in the split-screen panel"
                      onClick={() => onPreview(a)}
                    >
                      {a.lang === 'svg' ? '🖼 Preview SVG' : a.lang === 'html' ? '🌐 Preview' : `⌨ ${a.language ?? 'Code'}`}
                    </button>
                  ))}
                  {m.documents?.map((d, k) => (
                    <button
                      key={`doc${k}`}
                      className="ghost small"
                      title="Reopen this document in the split-screen panel"
                      onClick={() =>
                        onPreview({ lang: 'html', code: d.html, title: `📄 ${d.filename}.${d.format}` })
                      }
                    >
                      📄 {d.filename}.{d.format}
                    </button>
                  ))}
                </span>
                {regenIdx === i && (
                  <div className="regen-picker">
                    <span className="card-sub">Regenerate with:</span>
                    <ModelSelect
                      models={models}
                      value={`${conv.providerId}/${conv.modelId}`}
                      onChange={(v) => {
                        setRegenIdx(null)
                        onRegenerateWithModel(v)
                      }}
                      disabled={streaming}
                    />
                  </div>
                )}
                {verify[i] && (
                  <VerifyPanel
                    state={verify[i]}
                    modelLabel={(m.model ?? `${conv.providerId}/${conv.modelId}`).split('/').pop()!}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      ))}
      {streamText !== null && (
        <div className="msg msg-assistant">
          <div className="msg-body markdown">
            <AssistantIdentity model={`${conv.providerId}/${conv.modelId}`} />
            {streamReasoning && (
              <details
                className={`thinking-block${streamText === '' ? ' thinking-live' : ''}`}
                open={streamText === ''}
              >
                <summary>Thinking{streamText === '' ? '…' : ''}</summary>
                <div className="thinking-text live">{streamReasoning}</div>
              </details>
            )}
            {streamText !== '' && renderReply(collapseStreamingUrls(streamText))}
            <WorkingDots />
          </div>
        </div>
      )}
    </div>
  )
}

// The hallucination-check result shown under an assistant reply.
const VERDICT_META: Record<string, { label: string; cls: string }> = {
  'looks-solid': { label: 'Looks solid', cls: 'ok' },
  'some-risks': { label: 'Some risks', cls: 'warn' },
  'likely-issues': { label: 'Likely issues', cls: 'bad' },
  uncertain: { label: 'Uncertain', cls: 'neutral' }
}
const CLAIM_ICON: Record<string, string> = {
  supported: '✓',
  uncertain: '?',
  unsupported: '⚠',
  contradicted: '✕'
}

function VerifyPanel({
  state,
  modelLabel
}: {
  state: { loading: boolean; report?: VerifyReport }
  modelLabel: string
}): JSX.Element {
  if (state.loading && !state.report) {
    return (
      <div className="verify-panel loading">
        <WorkingDots /> Checking this answer for hallucinations…
        <span className="verify-sub">searching the web and cross-examining the claims</span>
      </div>
    )
  }
  const r = state.report
  if (!r) return <></>
  const vm = VERDICT_META[r.verdict] ?? VERDICT_META.uncertain
  return (
    <div className={`verify-panel ${state.loading ? 'rechecking' : ''}`}>
      <div className="verify-head">
        <span className="verify-title">🔍 Hallucination check</span>
        <span className={`verify-verdict ${vm.cls}`}>{vm.label}</span>
        {r.confidence != null && (
          <span className="verify-conf" title="Estimated confidence the answer is free of factual errors">
            <span className="verify-bar">
              <span className={`verify-bar-fill ${vm.cls}`} style={{ width: `${r.confidence}%` }} />
            </span>
            {r.confidence}%
          </span>
        )}
      </div>
      {r.summary && (
        <div className="verify-summary verify-md">
          <MarkdownView>{r.summary}</MarkdownView>
        </div>
      )}
      {r.claims.length > 0 && (
        <ul className="verify-claims">
          {r.claims.map((c, k) => (
            <li key={k} className={`verify-claim ${c.status}`}>
              <span className="verify-claim-icon" title={c.status}>
                {CLAIM_ICON[c.status] ?? '?'}
              </span>
              <div className="verify-claim-body">
                <div className="verify-claim-text verify-md">
                  <MarkdownView>{c.claim}</MarkdownView>
                </div>
                {c.note && (
                  <div className="verify-claim-note verify-md">
                    <MarkdownView>{c.note}</MarkdownView>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="verify-foot">
        {r.usedWeb ? '🌐 Grounded with a live web search · ' : ''}
        Checked by {modelLabel}. An AI reviewing an AI — treat this as a strong hint, not proof.
      </div>
    </div>
  )
}

/** ~4 characters per token — the standard rough heuristic when no tokenizer is available. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Current context size: the provider-reported total from the last assistant turn
 * (exact — it's what the model actually processed), plus an estimate for anything
 * added since (messages not yet sent to the model).
 */
function computeContextTokens(conv: Conversation): number {
  let base = 0
  let lastUsageIdx = -1
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const u = conv.messages[i].usage
    if (conv.messages[i].role === 'assistant' && u && (u.inputTokens != null || u.outputTokens != null)) {
      base = (u.inputTokens ?? 0) + (u.outputTokens ?? 0)
      lastUsageIdx = i
      break
    }
  }
  let estimated = lastUsageIdx === -1 ? estimateTokens(conv.systemPrompt) : 0
  for (let i = lastUsageIdx + 1; i < conv.messages.length; i++) {
    estimated += estimateTokens(conv.messages[i].content)
  }
  return base + estimated
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

/**
 * Subtle pre-send cost estimate (beta: cost-preview). Estimates the input side
 * (conversation context + your message, ~4 chars/token) plus a typical ~500-token
 * reply, priced via shared/modelPricing. Free/local models show "free"; models
 * with no known price render nothing.
 */
const TYPICAL_REPLY_TOKENS = 500
function CostPreview({
  providerId,
  modelId,
  inputTokens
}: {
  providerId: string
  modelId: string
  inputTokens: number
}) {
  const cost = estimateCost(providerId, modelId, inputTokens, TYPICAL_REPLY_TOKENS)
  if (cost == null) return null
  return (
    <span
      className="cost-preview"
      title={`Rough estimate for sending this message: ~${inputTokens.toLocaleString()} input tokens (context + your message) plus a typical reply, at this model's price. Actual cost depends on the reply length.`}
    >
      ≈ {formatCost(cost)}
    </span>
  )
}

function Composer({
  streaming,
  canRegenerate,
  templates,
  costProviderId,
  costModelId,
  contextTokens,
  onSend,
  onStop,
  onRegenerate,
  onOpenAttachment
}: {
  streaming: boolean
  canRegenerate: boolean
  templates: PromptTemplate[]
  costProviderId: string
  costModelId: string
  contextTokens: number
  onSend: (text: string, attachments: ChatAttachment[]) => void
  onStop: () => void
  onRegenerate: () => void
  onOpenAttachment: (a: ChatAttachment) => void
}) {
  const costPreviewOn = useBetaFlag('cost-preview')
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [showTemplates, setShowTemplates] = useState(false)
  const { state: dictation, toggle: toggleDictation } = useDictation((t) =>
    setText((prev) => (prev ? `${prev} ${t}`.replace(/\s+/g, ' ') : t))
  )

  const insertTemplate = (body: string) => {
    setText((prev) => (prev.trim() ? `${prev.trim()}\n${body}` : body))
    setShowTemplates(false)
  }

  const submit = () => {
    const t = text.trim()
    if ((!t && attachments.length === 0) || streaming) return
    setText('')
    setAttachments([])
    onSend(t, attachments)
  }

  const attach = async () => {
    const picked = await window.api.chat.pickAttachments()
    if (picked.length > 0) setAttachments((prev) => [...prev, ...picked])
  }

  const screenshot = async () => {
    const shot = await window.api.chat.captureScreen()
    if (shot) setAttachments((prev) => [...prev, shot])
  }

  return (
    <div className="composer">
      {attachments.length > 0 && (
        <div className="attach-chips">
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip">
              <button
                type="button"
                className="attach-chip-open"
                title="Click to preview"
                onClick={() => onOpenAttachment(a)}
              >
                {a.image ? '🖼' : '📎'} {a.name}
              </button>
              <button
                className="chip-remove"
                title="Remove"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        value={text}
        placeholder="Message… (Enter to send, Shift+Enter for a new line)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={3}
      />
      <div className="composer-actions">
        <button
          className="ghost icon-btn"
          onClick={attach}
          disabled={streaming}
          title="Attach documents or images (images need a vision-capable model)"
        >
          <AttachIcon /> Attach
        </button>
        <button
          className="ghost icon-btn"
          onClick={screenshot}
          disabled={streaming}
          title="Capture your screen and attach it (needs a vision-capable model)"
        >
          <CameraIcon /> Screenshot
        </button>
        <button
          className={`ghost icon-btn ${dictation !== 'idle' ? 'thinking-on' : ''}`}
          onClick={toggleDictation}
          disabled={dictation === 'transcribing'}
          title="Dictate your message with your voice (transcribed by Gemini)"
        >
          <MicIcon />{' '}
          {dictation === 'recording' ? 'Listening… (click to stop)' : dictation === 'transcribing' ? 'Transcribing…' : 'Dictate'}
        </button>
        {templates.length > 0 && (
          <div className="template-menu">
            <button
              className="ghost icon-btn"
              onClick={() => setShowTemplates((s) => !s)}
              title="Insert a saved prompt template"
            >
              <TemplateIcon /> Templates
            </button>
            {showTemplates && (
              <>
                <div className="template-backdrop" onClick={() => setShowTemplates(false)} />
                <div className="template-pop">
                  {templates.map((t) => (
                    <button key={t.id} className="template-item" onClick={() => insertTemplate(t.body)}>
                      <span className="template-item-title">{t.title}</span>
                      <span className="template-item-body">{t.body}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <div className="composer-spacer" />
        {costPreviewOn && !streaming && text.trim() !== '' && (
          <CostPreview
            providerId={costProviderId}
            modelId={costModelId}
            inputTokens={contextTokens + Math.ceil(text.length / 4)}
          />
        )}
        {streaming ? (
          <button className="icon-btn" onClick={onStop}>
            <StopIcon /> Stop
          </button>
        ) : (
          <>
            {canRegenerate && (
              <button className="ghost icon-btn" onClick={onRegenerate}>
                <RefreshIcon /> Regenerate
              </button>
            )}
            <button
              className="icon-btn"
              onClick={submit}
              disabled={!text.trim() && attachments.length === 0}
            >
              <SendIcon /> Send
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ---------- Landing composer (empty-state "how can I help" box) ----------
// A deliberately minimal, elegant composer: the model picker lives inside the
// box (bottom-left, opens upward), tools are icon-only, send is a round accent
// button — the ChatGPT/Claude pattern. Kept separate from the in-chat Composer.
function LandingComposer({
  models,
  modelValue,
  onModelChange,
  webSearch,
  onToggleWebSearch,
  canThink,
  effort,
  onEffort,
  onSend,
  onOpenAttachment
}: {
  models: ModelInfo[]
  modelValue: string
  onModelChange: (value: string) => void
  webSearch: boolean
  onToggleWebSearch: () => void
  canThink: boolean
  effort: Effort
  onEffort: (e: Effort) => void
  onSend: (text: string, attachments: ChatAttachment[]) => void
  onOpenAttachment: (a: ChatAttachment) => void
}) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const { state: dictation, toggle: toggleDictation } = useDictation((t) =>
    setText((prev) => (prev ? `${prev} ${t}`.replace(/\s+/g, ' ') : t))
  )

  const submit = () => {
    const t = text.trim()
    if (!t && attachments.length === 0) return
    setText('')
    setAttachments([])
    onSend(t, attachments)
  }

  const attach = async () => {
    const picked = await window.api.chat.pickAttachments()
    if (picked.length > 0) setAttachments((prev) => [...prev, ...picked])
  }
  const screenshot = async () => {
    const shot = await window.api.chat.captureScreen()
    if (shot) setAttachments((prev) => [...prev, shot])
  }

  return (
    <div className="landing-box">
      {attachments.length > 0 && (
        <div className="attach-chips">
          {attachments.map((a, i) => (
            <span key={i} className="attach-chip">
              <button
                type="button"
                className="attach-chip-open"
                title="Click to preview"
                onClick={() => onOpenAttachment(a)}
              >
                {a.image ? '🖼' : '📎'} {a.name}
              </button>
              <button
                className="chip-remove"
                title="Remove"
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        className="landing-textarea"
        value={text}
        autoFocus
        placeholder="Message Orbit…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        rows={2}
      />
      <div className="landing-bar">
        <ModelSelect models={models} value={modelValue} onChange={onModelChange} openUp />
        <div className="landing-tools">
          <button
            className={`landing-icon-btn ${webSearch ? 'on' : ''}`}
            title={
              webSearch
                ? 'Web search is ON — the model can look things up on the web for this chat'
                : 'Web search: let the model look things up on the web (no API key needed)'
            }
            onClick={onToggleWebSearch}
          >
            <GlobeIcon />
          </button>
          <LandingThinkingButton canThink={canThink} effort={effort} onEffort={onEffort} />
          <button className="landing-icon-btn" title="Attach documents or images" onClick={attach}>
            <AttachIcon />
          </button>
          <button className="landing-icon-btn" title="Capture your screen" onClick={screenshot}>
            <CameraIcon />
          </button>
          <button
            className={`landing-icon-btn ${dictation !== 'idle' ? 'on' : ''}`}
            title={
              dictation === 'recording'
                ? 'Recording… click to stop and transcribe'
                : dictation === 'transcribing'
                  ? 'Transcribing…'
                  : 'Dictate with your voice (transcribed by Gemini)'
            }
            disabled={dictation === 'transcribing'}
            onClick={toggleDictation}
          >
            <MicIcon />
          </button>
        </div>
        <button
          className="landing-send"
          title="Send"
          onClick={submit}
          disabled={!text.trim() && attachments.length === 0}
        >
          <SendIcon />
        </button>
      </div>
    </div>
  )
}

// Landing thinking control: an icon that opens a small Off/Low/Medium/High bar
// (like the toolbar ThinkingSelect, but icon-first for the minimal landing box).
// Greys out with an explanatory tooltip when the picked model can't reason.
const THINK_LEVELS: Effort[] = ['off', 'low', 'medium', 'high']
function LandingThinkingButton({
  canThink,
  effort,
  onEffort
}: {
  canThink: boolean
  effort: Effort
  onEffort: (e: Effort) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  if (!canThink) {
    return (
      <button
        className="landing-icon-btn"
        disabled
        title="This model does not support thinking mode"
      >
        <BrainIcon />
      </button>
    )
  }
  return (
    <div className="landing-think" ref={ref}>
      <button
        className={`landing-icon-btn ${effort !== 'off' ? 'on' : ''}`}
        title={
          effort === 'off'
            ? 'Extended thinking: choose how hard the model reasons before answering'
            : `Extended thinking: ${effort}`
        }
        onClick={() => setOpen((o) => !o)}
      >
        <BrainIcon />
      </button>
      {open && (
        <div className="landing-think-pop">
          <div className="landing-think-label">Thinking</div>
          {THINK_LEVELS.map((l) => (
            <button
              key={l}
              className={`landing-think-opt ${effort === l ? 'sel' : ''}`}
              onClick={() => {
                onEffort(l)
                setOpen(false)
              }}
            >
              {l === 'off' ? 'Off' : l[0].toUpperCase() + l.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------- Folders + pin + rename (chat list organisation) ----------

function FolderPlusInline() {
  return (
    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5V6.5Z" />
      <path d="M11 12h4M13 10v4" />
    </svg>
  )
}

function NewFolderInput({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  return (
    <div className="new-folder-row">
      <input
        autoFocus
        placeholder="Folder name…"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCreate(name)
          if (e.key === 'Escape') onCancel()
        }}
      />
      <button className="small" onClick={() => onCreate(name)} disabled={!name.trim()}>
        Add
      </button>
      <button className="ghost small" onClick={onCancel}>
        ✕
      </button>
    </div>
  )
}

// Date buckets for the ungrouped chat list (like Claude/ChatGPT): Today,
// Yesterday, Previous 7 days, Older — based on each chat's last-updated time.
const DATE_BUCKET_LABELS = ['Today', 'Yesterday', 'Previous 7 days', 'Older']
function dateBucket(ts: number): number {
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 86_400_000
  if (ts >= startOfToday) return 0
  if (ts >= startOfToday - day) return 1
  if (ts >= startOfToday - 7 * day) return 2
  return 3
}

function ChatGroups({
  metas,
  folders,
  activeId,
  onSelect,
  onRename,
  onPin,
  onMove,
  onDelete,
  onRenameFolder,
  onDeleteFolder
}: {
  metas: ConversationMeta[]
  folders: Folder[]
  activeId: string | null
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onMove: (id: string, folderId: string | undefined) => void
  onDelete: (id: string) => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
}) {
  const folderIds = new Set(folders.map((f) => f.id))
  const pinned = metas.filter((m) => m.pinned)
  const noFolder = metas.filter((m) => !m.pinned && (!m.folderId || !folderIds.has(m.folderId)))

  const item = (m: ConversationMeta) => (
    <ChatItem
      key={m.id}
      meta={m}
      folders={folders}
      active={activeId === m.id}
      onSelect={onSelect}
      onRename={onRename}
      onPin={onPin}
      onMove={onMove}
      onDelete={onDelete}
    />
  )

  return (
    <>
      {pinned.length > 0 && (
        <div className="chat-section">
          <div className="chat-section-head">
            <PinIcon /> Pinned
          </div>
          {pinned.map(item)}
        </div>
      )}
      {folders.map((f) => (
        <FolderSection
          key={f.id}
          folder={f}
          items={metas.filter((m) => !m.pinned && m.folderId === f.id)}
          renderItem={item}
          onRenameFolder={onRenameFolder}
          onDeleteFolder={onDeleteFolder}
        />
      ))}
      {(() => {
        // Ungrouped chats are shown newest-first and split into date buckets.
        const sorted = [...noFolder].sort((a, b) => b.updatedAt - a.updatedAt)
        const buckets: ConversationMeta[][] = [[], [], [], []]
        for (const m of sorted) buckets[dateBucket(m.updatedAt)].push(m)
        return buckets.map((items, i) =>
          items.length > 0 ? (
            <div className="chat-section" key={i}>
              <div className="chat-section-head">{DATE_BUCKET_LABELS[i]}</div>
              {items.map(item)}
            </div>
          ) : null
        )
      })()}
    </>
  )
}

function FolderSection({
  folder,
  items,
  renderItem,
  onRenameFolder,
  onDeleteFolder
}: {
  folder: Folder
  items: ConversationMeta[]
  renderItem: (m: ConversationMeta) => JSX.Element
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
}) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(folder.name)
  return (
    <div className="chat-section">
      <div className="chat-section-head folder-head">
        {renaming ? (
          <input
            className="folder-rename"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              onRenameFolder(folder.id, name)
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onRenameFolder(folder.id, name)
                setRenaming(false)
              }
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <>
            <span onDoubleClick={() => setRenaming(true)} title="Double-click to rename folder">
              <FolderPlusInline /> {folder.name} <span className="folder-count">{items.length}</span>
            </span>
            <button
              className="ghost small folder-del"
              title="Delete folder (chats move to Unfiled)"
              onClick={() => onDeleteFolder(folder.id)}
            >
              <CloseIcon />
            </button>
          </>
        )}
      </div>
      {items.map(renderItem)}
    </div>
  )
}

function ChatItem({
  meta,
  folders,
  active,
  onSelect,
  onRename,
  onPin,
  onMove,
  onDelete
}: {
  meta: ConversationMeta
  folders: Folder[]
  active: boolean
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onPin: (id: string, pinned: boolean) => void
  onMove: (id: string, folderId: string | undefined) => void
  onDelete: (id: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState(meta.title)

  const save = () => {
    onRename(meta.id, title)
    setRenaming(false)
  }
  const close = () => setMenuOpen(false)

  if (renaming) {
    return (
      <div className="chat-item renaming">
        <input
          className="chat-rename"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setRenaming(false)
          }}
        />
      </div>
    )
  }

  return (
    <div
      className={`chat-item ${active ? 'active' : ''}`}
      onClick={() => onSelect(meta.id)}
      onDoubleClick={() => {
        setTitle(meta.title)
        setRenaming(true)
      }}
    >
      {meta.pinned && <PinIcon className="icon chat-pin-badge" />}
      <span className="chat-item-title">{meta.title}</span>
      <button
        className="ghost small chat-item-menu"
        title="More"
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((o) => !o)
        }}
      >
        <DotsIcon />
      </button>
      {menuOpen && (
        <>
          <div className="menu-backdrop" onClick={(e) => { e.stopPropagation(); close() }} />
          <div className="chat-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setTitle(meta.title); setRenaming(true); close() }}>Rename</button>
            <button onClick={() => { onPin(meta.id, !meta.pinned); close() }}>
              {meta.pinned ? 'Unpin' : 'Pin to top'}
            </button>
            {folders.length > 0 && <div className="chat-menu-label">Move to folder</div>}
            {folders.map((f) => (
              <button key={f.id} onClick={() => { onMove(meta.id, f.id); close() }}>
                {meta.folderId === f.id ? '✓ ' : ''}
                {f.name}
              </button>
            ))}
            {meta.folderId && (
              <button onClick={() => { onMove(meta.id, undefined); close() }}>Remove from folder</button>
            )}
            <div className="chat-menu-sep" />
            <button className="danger" onClick={() => { onDelete(meta.id); close() }}>
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ---------- Cost & token dashboard (per chat) ----------

function CostPanel({ conv, onClose }: { conv: Conversation; onClose: () => void }) {
  const rows = useMemo(() => {
    const map = new Map<string, { input: number; output: number; count: number }>()
    for (const m of conv.messages) {
      if (m.role !== 'assistant' || !m.usage) continue
      const key = m.model ?? `${conv.providerId}/${conv.modelId}`
      const cur = map.get(key) ?? { input: 0, output: 0, count: 0 }
      cur.input += m.usage.inputTokens ?? 0
      cur.output += m.usage.outputTokens ?? 0
      cur.count += 1
      map.set(key, cur)
    }
    return [...map.entries()].map(([key, v]) => {
      const [providerId, ...rest] = key.split('/')
      const modelId = rest.join('/')
      return { key, modelId, ...v, cost: estimateCost(providerId, modelId, v.input, v.output) }
    })
  }, [conv])

  const totalIn = rows.reduce((s, r) => s + r.input, 0)
  const totalOut = rows.reduce((s, r) => s + r.output, 0)
  const knownCost = rows.reduce((s, r) => s + (r.cost ?? 0), 0)
  const anyUnknown = rows.some((r) => r.cost == null)

  return (
    <div className="cost-panel">
      <div className="cost-head">
        <strong>Cost &amp; tokens for this chat</strong>
        <div className="composer-spacer" />
        <button className="ghost small" onClick={onClose}>
          ✕
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="card-sub">No replies yet — costs appear after the model answers.</div>
      ) : (
        <>
          <table className="cost-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Replies</th>
                <th>Input</th>
                <th>Output</th>
                <th>Est. cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.modelId}</td>
                  <td>{r.count}</td>
                  <td>{formatTokens(r.input)}</td>
                  <td>{formatTokens(r.output)}</td>
                  <td>{r.cost == null ? '—' : formatCost(r.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td />
                <td>{formatTokens(totalIn)}</td>
                <td>{formatTokens(totalOut)}</td>
                <td>{formatCost(knownCost)}{anyUnknown ? '+' : ''}</td>
              </tr>
            </tfoot>
          </table>
          <div className="card-sub cost-note">
            Costs are estimates from public per-token pricing and may not match your bill.
            {anyUnknown ? ' “—” = no price on record for that model.' : ''}
          </div>
        </>
      )}
      <AutopilotSavings />
    </div>
  )
}

/** Cumulative Autopilot savings (all chats), shown in the cost dashboard. */
function AutopilotSavings() {
  const on = useBetaFlag('autopilot')
  const [saved, setSaved] = useState(() => getAutopilotSavings())
  useEffect(() => {
    const h = (): void => setSaved(getAutopilotSavings())
    window.addEventListener('orbit-autopilot-savings', h)
    window.addEventListener('storage', h)
    return () => {
      window.removeEventListener('orbit-autopilot-savings', h)
      window.removeEventListener('storage', h)
    }
  }, [])
  if (!on || saved <= 0) return null
  return (
    <div className="autopilot-savings" title="Estimated savings from Autopilot routing easy messages to cheaper models instead of always using your most expensive model.">
      ⚡ Autopilot has saved you about <strong>{formatCost(saved)}</strong> vs sending everything to
      your priciest model.
    </div>
  )
}
