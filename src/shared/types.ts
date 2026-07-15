export type ProviderKind = 'anthropic' | 'openai' | 'google' | 'openai-compat'

export interface ProviderInfo {
  id: string
  kind: ProviderKind
  label: string
  /** Only set for openai-compat providers (incl. Ollama) */
  baseURL?: string
  builtin: boolean
  /** false for local providers like Ollama */
  needsKey: boolean
  hasKey: boolean
  /**
   * Subscription tier for this provider's key. 'free' hides models that a free
   * plan can't call (avoids paying-only models erroring); 'paid' shows all.
   * Defaults to 'paid' when unset.
   */
  plan?: 'free' | 'paid'
}

export interface ModelInfo {
  /** unique key: `${providerId}/${modelId}` */
  id: string
  modelId: string
  providerId: string
  label: string
  contextWindow: number
  builtin: boolean
}

export interface CustomProviderInput {
  label: string
  kind: ProviderKind
  baseURL?: string
}

export interface CustomModelInput {
  providerId: string
  modelId: string
  label?: string
  contextWindow?: number
}

export interface TestResult {
  ok: boolean
  message: string
}

// ---------- Prompt templates (reusable prompts) ----------

export interface PromptTemplate {
  id: string
  title: string
  body: string
}

// ---------- Cross-chat search ----------

export interface ConversationSearchHit {
  id: string
  title: string
  updatedAt: number
  projectId?: string
  /** a short excerpt around the first match (title match → empty) */
  snippet: string
  /** true when the query matched message text (vs. only the title) */
  inBody: boolean
}

// ---------- Model compare (side-by-side) ----------

export interface CompareColumnInput {
  providerId: string
  modelId: string
  /** prior turns for THIS column (user + this model's own answers) */
  history: { role: 'user' | 'assistant'; content: string }[]
}

export interface CompareChunkEvent {
  runId: string
  index: number
  delta: string
}

export interface CompareDoneEvent {
  runId: string
  index: number
  usage?: TokenUsage
}

export interface CompareErrorEvent {
  runId: string
  index: number
  message: string
}

// ---------- Council (beta): panelists answer, then a judge writes a verdict ----------

export interface CouncilPanelist {
  providerId: string
  modelId: string
  label: string
}
export interface CouncilRunInput {
  prompt: string
  panelists: CouncilPanelist[]
  judge: { providerId: string; modelId: string }
}
export interface CouncilAnswerChunkEvent {
  runId: string
  index: number
  delta: string
}
export interface CouncilAnswerDoneEvent {
  runId: string
  index: number
  error?: string
}
export interface CouncilVerdictChunkEvent {
  runId: string
  delta: string
}
export interface CouncilStatusEvent {
  runId: string
  text: string
}
export interface CouncilDoneEvent {
  runId: string
}
export interface CouncilErrorEvent {
  runId: string
  message: string
}

// ---------- Personal benchmarks (beta) ----------

export interface BenchmarkPrompt {
  id: string
  text: string
}
export interface BenchmarkResult {
  promptId: string
  promptText: string
  /** `${providerId}/${modelId}` */
  model: string
  modelLabel: string
  /** judge score 0–10 (0 = failed/unscored) */
  score: number
  seconds: number
  cost: number | null
  error?: string
}
export interface BenchmarkRun {
  id: string
  at: number
  judgeModel: string
  results: BenchmarkResult[]
}
export interface BenchmarkData {
  prompts: BenchmarkPrompt[]
  history: BenchmarkRun[]
}
export interface BenchmarkModel {
  providerId: string
  modelId: string
  label: string
}
export interface BenchmarkRunInput {
  prompts: BenchmarkPrompt[]
  models: BenchmarkModel[]
  judge: BenchmarkModel
}

export interface OllamaStatus {
  running: boolean
  url: string
  models: ModelInfo[]
}

// ---------- Hallucination / fact check ("Verify") ----------
// A second, critical pass over an assistant answer: optionally grounded with a
// live web search, a verifier model breaks the answer into factual claims and
// rates each, then gives an overall verdict + confidence. It is a strong signal,
// not a guarantee (an AI checking an AI) — the UI says as much.

export type VerifyClaimStatus = 'supported' | 'unsupported' | 'contradicted' | 'uncertain'

export interface VerifyClaim {
  /** the factual claim, quoted/paraphrased from the answer */
  claim: string
  status: VerifyClaimStatus
  /** short reason for the status (evidence, or why it's doubtful) */
  note?: string
}

export type VerifyVerdict = 'looks-solid' | 'some-risks' | 'likely-issues' | 'uncertain'

export interface VerifyReport {
  verdict: VerifyVerdict
  /** 0–100 confidence that the answer is free of hallucinations; null = unknown */
  confidence: number | null
  /** one- or two-sentence plain-language summary of the check */
  summary: string
  claims: VerifyClaim[]
  /** true if live web results were used to ground the check */
  usedWeb?: boolean
  /** the web-search queries that were run (when usedWeb) */
  queries?: string[]
  /** set when the check itself failed to run */
  error?: string
}

export interface VerifyInput {
  /** verifier model */
  providerId: string
  modelId: string
  /** the user's question that prompted the answer (for context) */
  question: string
  /** the assistant answer being checked */
  answer: string
  /** ground the check with a live web search */
  useWeb: boolean
}

// ---------- Chat / conversations ----------

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** the model's reasoning ("thinking"), when extended thinking was on and the provider returned it */
  reasoning?: string
  /** set on assistant messages */
  usage?: TokenUsage
  /** output tokens per second for this reply (generation speed) */
  tps?: number
  /** `${providerId}/${modelId}` that produced this message */
  model?: string
  /** true if generation was stopped early */
  aborted?: boolean
  /** files attached to a user message (text is sent inline; images as image parts) */
  attachments?: ChatAttachment[]
}

/** Background auto-update status pushed from main → renderer. */
export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'none' }
  | { status: 'downloading'; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'idle' }

export interface ConversationMeta {
  id: string
  title: string
  providerId: string
  modelId: string
  updatedAt: number
  /** set when the conversation belongs to a project */
  projectId?: string
  /** pinned chats sort to the top of the list */
  pinned?: boolean
  /** id of the folder this chat is filed under (undefined = no folder) */
  folderId?: string
}

export interface Conversation extends ConversationMeta {
  systemPrompt: string
  createdAt: number
  /** extended thinking on/off (applied per provider; ignored where unsupported) */
  thinking?: boolean
  /** reasoning effort level when thinking is on (maps to provider reasoning budget/effort) */
  effort?: 'low' | 'medium' | 'high'
  /** web-search tool on/off (gives tool-capable models a keyless web search) */
  webSearch?: boolean
  /** Autopilot (beta): route each message to an easy/best model automatically.
   *  providerId/modelId still hold the last-routed model (fallback + context display). */
  autopilot?: boolean
  messages: ChatMessage[]
  /** set when this conversation belongs to a project (enables RAG + project instructions) */
  projectId?: string
}

/** A folder for organising chats (stored in config). */
export interface Folder {
  id: string
  name: string
}

export interface ChatChunkEvent {
  conversationId: string
  delta: string
  /** true when this delta is reasoning ("thinking") text, not answer text */
  reasoning?: boolean
}

export interface ChatDoneEvent {
  conversationId: string
  message: ChatMessage
}

export interface ChatErrorEvent {
  conversationId: string
  message: string
}

/** Emitted after the create_document tool saves an Office file — the renderer
 *  shows the rendered document in the split-screen panel. */
export interface DocumentPreviewEvent {
  conversationId: string
  format: 'docx' | 'xlsx' | 'pptx'
  filename: string
  path: string
  /** self-contained HTML preview of the document content */
  html: string
}

// ---------- Projects / RAG ----------

export interface ProjectChunk {
  text: string
  /** present when an embedder was available at ingestion time */
  embedding?: number[]
}

export interface ProjectFile {
  id: string
  name: string
  size: number
  addedAt: number
  chunkCount: number
  /** id of the embedder used, e.g. "ollama/nomic-embed-text" — undefined = keyword search only */
  embeddingModel?: string
}

export interface ProjectMeta {
  id: string
  name: string
  updatedAt: number
  fileCount: number
}

export interface Project {
  id: string
  name: string
  instructions: string
  createdAt: number
  updatedAt: number
  files: ProjectFile[]
}

// ---------- Chat attachments ----------

export interface ChatAttachment {
  name: string
  /** extracted plain text (document attachments) */
  text?: string
  /** data URL (image attachments — sent to vision-capable models as an image part) */
  image?: string
}

// ---------- MCP ----------

export interface McpServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'http'
  /** stdio: full command line, e.g. "npx -y @modelcontextprotocol/server-filesystem C:\data" */
  command?: string
  /** http: server URL */
  url?: string
  enabled: boolean
}

export interface McpServerStatus extends McpServerConfig {
  connected: boolean
  error?: string
  toolNames: string[]
}

export interface ToolRequestEvent {
  requestId: string
  conversationId: string
  serverName: string
  toolName: string
  args: unknown
}

// ---------- Cowork ----------

import type { DiffLine } from './diff'
export type { DiffLine, DiffBlock } from './diff'

/**
 * ask        — every file change and every command needs the user's OK
 * auto-edits — file writes/deletes run without asking; commands still ask
 * auto-all   — everything runs without asking
 * (reading files never asks in any mode)
 */
export type CoworkApprovalMode = 'ask' | 'auto-edits' | 'auto-all'

export type CoworkEvent =
  | { type: 'user'; text: string; at: number }
  | { type: 'text'; text: string; at: number }
  | { type: 'tool-call'; toolName: string; args: unknown; at: number }
  | { type: 'tool-result'; toolName: string; result: string; error?: boolean; diff?: DiffLine[]; at: number }
  | { type: 'status'; text: string; at: number }
  | { type: 'error'; text: string; at: number }

/** Reasoning-effort level for thinking-capable models (Anthropic / OpenAI
 *  reasoning / Gemini). 'off' = no extended thinking. */
export type ReasoningEffort = 'off' | 'low' | 'medium' | 'high'

export interface CoworkSessionMeta {
  id: string
  title: string
  workspace: string | null
  providerId: string
  modelId: string
  mode: CoworkApprovalMode
  /** reasoning effort for thinking-capable models (default off) */
  effort?: ReasoningEffort
  updatedAt: number
}

export interface CoworkSession extends CoworkSessionMeta {
  createdAt: number
  events: CoworkEvent[]
  /** raw AI SDK model messages for multi-turn continuation (opaque to the renderer) */
  history: unknown[]
}

/** Live streaming events pushed to the renderer while an agent run is active */
export type CoworkLiveEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'reasoning-delta'; delta: string }
  | { type: 'tool-call'; toolName: string; args: unknown }
  | { type: 'tool-result'; toolName: string; result: string; error?: boolean; diff?: DiffLine[] }
  /** per-step token usage, so the UI can show a live running total while working */
  | { type: 'usage'; stepTokens: number }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface CoworkEventPayload {
  sessionId: string
  ev: CoworkLiveEvent
}

export interface CoworkToolRequestEvent {
  requestId: string
  sessionId: string
  toolName: string
  args: unknown
  /** write_file only: before/after preview. null = file too large to diff. */
  diff?: DiffLine[] | null
  /** write_file only: "+12 −3" */
  diffSummary?: string
}

// ---------- Swarm (multi-agent orchestration — beta) ----------
// A "lead" (manager) model breaks a task into subtasks and assigns each to a
// worker model; workers run in parallel; the lead then synthesises the results.
// Deliberately SEPARATE from Cowork (own storage dir, own sessions).

export interface SwarmWorker {
  /** stable id within the session */
  id: string
  providerId: string
  modelId: string
}

export type SwarmSubtaskStatus = 'pending' | 'running' | 'done' | 'error'

export interface SwarmSubtask {
  id: string
  /** which worker (SwarmWorker.id) is handling this */
  workerId: string
  /** the worker's `${providerId}/${modelId}` (for display) */
  model: string
  title: string
  assignment: string
  output: string
  status: SwarmSubtaskStatus
  error?: string
}

export interface SwarmTurn {
  task: string
  subtasks: SwarmSubtask[]
  synthesis: string
  at: number
}

export interface SwarmSessionMeta {
  id: string
  title: string
  managerProviderId: string
  managerModelId: string
  workerCount: number
  updatedAt: number
}

export interface SwarmSession extends SwarmSessionMeta {
  createdAt: number
  workers: SwarmWorker[]
  turns: SwarmTurn[]
}

/** Live streaming events pushed to the renderer during a swarm run. */
export type SwarmLiveEvent =
  | { type: 'status'; text: string }
  | { type: 'plan'; subtasks: { id: string; workerId: string; model: string; title: string; assignment: string }[] }
  | { type: 'worker-chunk'; subtaskId: string; delta: string }
  | { type: 'worker-done'; subtaskId: string }
  | { type: 'worker-error'; subtaskId: string; message: string }
  | { type: 'synthesis-chunk'; delta: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface SwarmEventPayload {
  sessionId: string
  ev: SwarmLiveEvent
}

// ---------- Studio (design) ----------
// Describe a web page / UI in plain words; the model returns ONE self-contained
// HTML document which is shown in a live preview. Iterative: each new prompt can
// refine the previous page. Separate storage dir (userData/studio).

export interface StudioTurn {
  prompt: string
  /** the full self-contained HTML the model produced for this turn */
  html: string
  at: number
}

export interface StudioSessionMeta {
  id: string
  title: string
  providerId: string
  modelId: string
  /** reasoning effort for thinking-capable models (default off) */
  effort?: ReasoningEffort
  updatedAt: number
}

export interface StudioSession extends StudioSessionMeta {
  createdAt: number
  turns: StudioTurn[]
}

/** Live streaming events pushed to the renderer during a design run. */
export type StudioLiveEvent =
  | { type: 'status'; text: string }
  | { type: 'code-delta'; delta: string }
  | { type: 'preview'; url: string; html: string }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface StudioEventPayload {
  sessionId: string
  ev: StudioLiveEvent
}

// ---------- Forge (Claude Code clone — developer coding environment) ----------
// A developer-grade agentic coder that works directly on a real project folder:
// navigates the codebase, runs commands (git, tests, builds), reads compiler /
// terminal errors and writes/refactors code. Shares the Cowork session/tool
// shapes (same tool set + approval model) but has its OWN storage (userData/forge)
// and a developer-focused system prompt + terminal-style UI.
export type ForgeApprovalMode = CoworkApprovalMode
export type ForgeEvent = CoworkEvent
export type ForgeSessionMeta = CoworkSessionMeta
export type ForgeSession = CoworkSession
export type ForgeLiveEvent = CoworkLiveEvent
export type ForgeEventPayload = CoworkEventPayload
export type ForgeToolRequestEvent = CoworkToolRequestEvent

// ---------- Skills ----------

export interface SkillInfo {
  /** folder name */
  id: string
  name: string
  description: string
  enabled: boolean
}
