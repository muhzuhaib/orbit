// Parsing + filtering of provider "list models" API responses.
// Electron-free on purpose so plain Node can unit-test it.
//
// WHY: model lists must come from the provider at runtime — hard-coded lists go
// stale (deprecated models linger, new ones never appear) and the app can't be
// updated often. Context windows are NOT returned by Anthropic/OpenAI list
// endpoints, so those use conservative pattern heuristics (Google returns
// inputTokenLimit directly).

export interface CatalogModel {
  modelId: string
  label: string
  contextWindow: number
}

// ---------- Model "kind" classification (for the picker badges) ----------
// Pure name heuristics — no API tells us this, so we infer from the model id.
// 'thinking' = reasoning-first (slower, better on hard problems);
// 'fast'     = small/low-latency; 'standard' = everything else.

export type ModelKind = 'thinking' | 'fast' | 'standard'

const THINKING_RE =
  /(?:^|[-/_:])(o[1-4])(?:[-_]|$)|gpt-5|reason|reasoner|thinking|think|-r1|deepseek-r|qwq|magistral|glm-z1|glm-4\.6|grok-.*(mini|reason)/i
const FAST_RE =
  /flash|mini|nano|haiku|instant|-lite|:lite|-air|:air|small|turbo|scout|phi-?[0-9]|gemma-?[0-9]?:?[0-9]|(?:^|[-:])(?:0\.5b|1\.5b|1b|3b|4b|7b|8b)\b/i

/** Classify a model for the picker (thinking / fast / standard). */
export function classifyModel(modelId: string): ModelKind {
  const id = modelId.toLowerCase()
  if (THINKING_RE.test(id)) return 'thinking'
  if (FAST_RE.test(id)) return 'fast'
  return 'standard'
}

/**
 * Whether the extended-thinking toggle is meaningful for this model — i.e.
 * turning it on actually changes a request option the provider honours:
 *   - Anthropic: all current Claude models accept a thinking budget.
 *   - Google: Gemini 2.x/3.x accept thinkingConfig.
 *   - OpenAI: only reasoning models (o-series, gpt-5) accept reasoningEffort;
 *     sending it to gpt-4o etc. errors — so gate on the reasoning classification.
 *   - OpenAI-compatible: no standard thinking option exists, so the toggle does
 *     nothing (reasoning-capable ones stream their thoughts regardless) → hide it.
 * `kind` is the provider kind; unknown kinds default to no toggle.
 */
export function supportsThinking(kind: string | undefined, modelId: string): boolean {
  switch (kind) {
    case 'anthropic':
      // Claude 3 (non-3.7) had no thinking; every model this app lists is newer.
      return !/claude-3-(opus|sonnet|haiku)/.test(modelId.toLowerCase())
    case 'google':
      return true
    case 'openai':
      return classifyModel(modelId) === 'thinking'
    default:
      return false
  }
}

// ---------- Context-window heuristic for OpenAI-compatible models ----------
// Their /models endpoints don't report a context size, so infer generously
// from the model family. The old flat 8K default made the token counter warn
// far too early for modern large-context models.

export function compatContext(id: string, fallback = 131_072): number {
  const s = id.toLowerCase()
  if (/qwen.*long|-long|1m/.test(s)) return 1_000_000
  if (/qwen3|qwen-?2\.5|qwen-plus/.test(s)) return 262_144
  if (/glm-4\.6/.test(s)) return 200_000
  if (/gpt-oss|deepseek|glm-4|llama-?3|llama3|kimi|moonshot|mistral|mixtral|command-?r|yi-/.test(s))
    return 131_072
  if (/gemma-?3|gemma3/.test(s)) return 131_072
  if (/gemma/.test(s)) return 8_192
  return fallback
}

// ---------- Anthropic: GET https://api.anthropic.com/v1/models?limit=1000 ----------

interface AnthropicList {
  data?: { id: string; display_name?: string }[]
}

function anthropicContext(id: string): number {
  // 1M-context families (per platform.claude.com docs); everything else 200K.
  if (/sonnet-5|opus-4-[89]|fable|mythos/.test(id)) return 1_000_000
  return 200_000
}

export function parseAnthropicModels(json: unknown): CatalogModel[] {
  const data = (json as AnthropicList).data ?? []
  return data
    .filter((m) => typeof m.id === 'string' && m.id.startsWith('claude'))
    .map((m) => ({
      modelId: m.id,
      label: m.display_name || m.id,
      contextWindow: anthropicContext(m.id)
    }))
}

// ---------- OpenAI: GET https://api.openai.com/v1/models ----------

interface OpenAIList {
  data?: { id: string; created?: number }[]
}

// Chat-capable families only — the endpoint also lists embeddings, audio,
// image, moderation and legacy completion models.
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/
const OPENAI_NOT_CHAT =
  /(embed|whisper|tts|audio|realtime|image|dall-e|moderation|transcribe|search|computer-use|instruct|davinci|babbage|codex)/
// Dated snapshots (gpt-4o-2024-08-06) duplicate their alias — hide them.
const DATED_SNAPSHOT = /\d{4}-\d{2}-\d{2}/

function openaiContext(id: string): number {
  if (/^gpt-5/.test(id)) return 400_000
  if (/^gpt-4\.1/.test(id)) return 1_000_000
  if (/^(o\d|gpt-4o|chatgpt-4o|gpt-4-turbo)/.test(id)) return 128_000
  if (/^gpt-4/.test(id)) return 8_192
  if (/^gpt-3\.5/.test(id)) return 16_385
  return 128_000
}

export function parseOpenAIModels(json: unknown): CatalogModel[] {
  const data = (json as OpenAIList).data ?? []
  return data
    .filter(
      (m) =>
        typeof m.id === 'string' &&
        OPENAI_CHAT.test(m.id) &&
        !OPENAI_NOT_CHAT.test(m.id) &&
        !DATED_SNAPSHOT.test(m.id)
    )
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))
    .map((m) => ({ modelId: m.id, label: m.id, contextWindow: openaiContext(m.id) }))
}

// ---------- Google: GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000 ----------

interface GoogleList {
  models?: {
    name?: string
    displayName?: string
    inputTokenLimit?: number
    supportedGenerationMethods?: string[]
  }[]
}

// Chat models only — skip embedding/image/video/audio/tts specialists that
// still advertise generateContent.
const GOOGLE_NOT_CHAT = /(embedding|aqa|imagen|veo|-tts|image|audio|dialog)/

export function parseGoogleModels(json: unknown): CatalogModel[] {
  const models = (json as GoogleList).models ?? []
  return models
    .filter((m) => {
      const id = (m.name ?? '').replace(/^models\//, '')
      return (
        id.length > 0 &&
        (m.supportedGenerationMethods ?? []).includes('generateContent') &&
        !GOOGLE_NOT_CHAT.test(id)
      )
    })
    .map((m) => {
      const id = (m.name ?? '').replace(/^models\//, '')
      return {
        modelId: id,
        label: m.displayName || id,
        contextWindow: m.inputTokenLimit && m.inputTokenLimit > 0 ? m.inputTokenLimit : 32_768
      }
    })
}

/**
 * Google's list API includes models an account can NOT actually call (retired
 * "no longer available to new users" → 404, paid-tier-only on free keys → 429
 * with a zero free-tier quota, or key-not-permitted → 403). Decide from a
 * 1-token probe whether to keep a model. Anything ambiguous (plain rate limits,
 * transient errors) is kept — better to show a model that errors than hide one
 * that works.
 */
export function googleProbeVerdict(status: number, body: string): 'keep' | 'drop' {
  const b = body.toLowerCase()
  if (status === 404) return 'drop' // retired / not available to this account
  if (status === 403) return 'drop' // key not permitted for this model (often paid-only)
  // Paid-tier-only models on a free key: the free-tier quota is zero, or the
  // message says the model needs a billed / paid account.
  if (
    (status === 429 || status === 400) &&
    /limit:\s*0|"?limit"?\s*:\s*"?0|free[_ ]tier|billed users?|only.*(?:paid|billing)|not available (?:in|on|for|to).*free/.test(b)
  )
    return 'drop'
  return 'keep'
}

/**
 * OpenAI-compatible catalogs (Ollama Cloud, DeepSeek, GLM, Kimi, Qwen, Groq…)
 * list their WHOLE catalog to any valid key — including models the account
 * can't actually run because it hasn't paid / the plan doesn't include them.
 * A 1-token chat probe tells us which is which:
 *   'keep'    — the probe succeeded (2xx): this key can use the model.
 *   'drop'    — a DETERMINISTIC "can't use": payment required / plan doesn't
 *               cover it / model not accessible (402/403/404), or an error body
 *               that plainly says the account is unpaid or lacks access. These
 *               are safe to hide — they don't happen for a working model.
 *   'unknown' — bad/unauthorized key (401), a plain rate-limit (429) or any
 *               other transient error: we genuinely can't tell, so never hide a
 *               model (or blank a provider) over it.
 */
export type CompatVerdict = 'keep' | 'drop' | 'unknown'

export function compatUsabilityVerdict(status: number, body = ''): CompatVerdict {
  if (status >= 200 && status < 300) return 'keep'
  if (status === 402 || status === 403 || status === 404) return 'drop'
  const b = body.toLowerCase()
  if (
    /insufficient|not enough balance|balance is|欠费|余额不足|余额|recharge|top ?up|arrears|arrearage|payment required|not (?:been )?(?:purchased|subscribed|activated|entitled)|no permission|not authorized to (?:use|access)|do(?:es)? not have access|access denied|no available (?:channel|model)|plan does not (?:include|allow|support)|upgrade your plan|please .{0,20}(?:recharge|purchase|subscribe)/.test(
      b
    )
  )
    return 'drop'
  return 'unknown'
}

// ---------- OpenAI-compatible servers: GET {baseURL}/models ----------

// Many OpenAI-compatible catalogs (Ollama Cloud, DeepSeek, Qwen/DashScope, GLM,
// Groq, OpenRouter…) also list non-chat models that error or make no sense in a
// chat box: embeddings, rerankers, speech/audio, image/video generation, OCR,
// moderation, and guard models. Hide them so the picker only shows models that
// actually work for chat.
const COMPAT_NOT_CHAT =
  /(embed|embedding|rerank|reranker|tts|stt|whisper|speech|voice|audio|transcrib|asr|dall-?e|image|img|vision-?embed|-vl-ocr|ocr|moderation|guard|safety|nomic|bge-|gte-|e5-|text-embedding|video|-veo|sora|imagen|paraformer|sambert|cosyvoice|wan-|animate)/i

export function parseCompatModels(json: unknown, defaultContext = 131_072): CatalogModel[] {
  const data = (json as OpenAIList).data ?? []
  return data
    .filter(
      (m) => typeof m.id === 'string' && m.id.length > 0 && !COMPAT_NOT_CHAT.test(m.id)
    )
    .map((m) => ({ modelId: m.id, label: m.id, contextWindow: compatContext(m.id, defaultContext) }))
}

// ---------- Free-plan model filter (subscription tier) ----------
// When the user marks a provider's key as "free plan", hide models that a free
// plan can't call (so they don't just error). Best-effort per provider: for
// providers where every listed model is usable on a free plan, or where we
// can't tell, this returns true (keep the model). The UI notes it's a guide.

const NEVER = /(?!)/ // a regex that matches nothing
const FREE_TIER: Record<string, RegExp> = {
  // OpenAI has no free API tier — nothing is callable on a free plan.
  openai: NEVER,
  // Google AI Studio free tier: Flash / Flash-Lite / Gemma; Pro is paid-only.
  google: /flash|gemma/i,
  // Anthropic API is paid-only (no free-tier keys).
  anthropic: NEVER
}

/**
 * Whether a model should be shown when the provider is set to the FREE plan.
 * Providers not listed here (DeepSeek, Qwen, GLM, Kimi, Ollama, custom) are
 * treated as "all models available" — their free/trial credit covers the
 * catalog, and the live probe already drops anything the key can't call.
 */
export function freeTierAllows(providerId: string, modelId: string): boolean {
  const re = FREE_TIER[providerId]
  if (!re) return true
  return re.test(modelId)
}
