import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { ModelInfo, OllamaStatus, ProviderInfo } from '../shared/types'
import {
  parseAnthropicModels,
  parseCompatModels,
  parseGoogleModels,
  parseOpenAIModels,
  type CatalogModel
} from '../shared/modelCatalog'
import { getConfig, getKey, hasKey } from './settings'

// Built-in providers. Ollama (local) is a keyless local server; Ollama Cloud is
// ollama.com's hosted API (free or paid account key — no local install needed).
// DeepSeek / Qwen / GLM are OpenAI-compatible hosted APIs (add a key in Settings).
export const OLLAMA_CLOUD_ID = 'ollama-cloud'
export const OLLAMA_CLOUD_URL = 'https://ollama.com/v1'

// Fixed base URLs for the built-in OpenAI-compatible providers.
const BUILTIN_COMPAT_URLS: Record<string, string> = {
  [OLLAMA_CLOUD_ID]: OLLAMA_CLOUD_URL,
  deepseek: 'https://api.deepseek.com/v1',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  glm: 'https://api.z.ai/api/paas/v4',
  kimi: 'https://api.moonshot.ai/v1',
  groq: 'https://api.groq.com/openai/v1'
}

const BUILTIN_PROVIDERS: Omit<ProviderInfo, 'hasKey'>[] = [
  { id: 'anthropic', kind: 'anthropic', label: 'Anthropic (Claude)', builtin: true, needsKey: true },
  { id: 'openai', kind: 'openai', label: 'OpenAI (ChatGPT)', builtin: true, needsKey: true },
  { id: 'google', kind: 'google', label: 'Google (Gemini)', builtin: true, needsKey: true },
  { id: 'deepseek', kind: 'openai-compat', label: 'DeepSeek', builtin: true, needsKey: true },
  { id: 'qwen', kind: 'openai-compat', label: 'Qwen (Alibaba)', builtin: true, needsKey: true },
  { id: 'glm', kind: 'openai-compat', label: 'GLM (Zhipu / Z.ai)', builtin: true, needsKey: true },
  { id: 'kimi', kind: 'openai-compat', label: 'Kimi (Moonshot)', builtin: true, needsKey: true },
  { id: 'groq', kind: 'openai-compat', label: 'Groq', builtin: true, needsKey: true },
  { id: OLLAMA_CLOUD_ID, kind: 'openai-compat', label: 'Ollama Cloud', builtin: true, needsKey: true },
  { id: 'ollama', kind: 'openai-compat', label: 'Ollama (local)', builtin: true, needsKey: false }
]

// NOTE: there is deliberately NO static fallback model list any more. Showing
// placeholder models a user might not be able to call is exactly the problem
// this app solves — the picker only ever shows live-fetched (and usability-
// probed) models, or nothing for a provider we can't verify.

const DEFAULT_OLLAMA_CONTEXT = 32_768

export function listProviders(): ProviderInfo[] {
  const cfg = getConfig()
  const plan = (id: string): 'free' | 'paid' => cfg.providerPlans[id] ?? 'paid'
  const builtin: ProviderInfo[] = BUILTIN_PROVIDERS.map((p) => ({
    ...p,
    baseURL: p.id === 'ollama' ? cfg.ollamaUrl : BUILTIN_COMPAT_URLS[p.id],
    hasKey: hasKey(p.id),
    plan: plan(p.id)
  }))
  const custom: ProviderInfo[] = cfg.customProviders.map((p) => ({
    id: p.id,
    kind: p.kind,
    label: p.label,
    baseURL: p.baseURL,
    builtin: false,
    needsKey: true,
    hasKey: hasKey(p.id),
    plan: plan(p.id)
  }))
  return [...builtin, ...custom]
}

export function getProvider(id: string): ProviderInfo | undefined {
  return listProviders().find((p) => p.id === id)
}

// ---------- Live model lists (fetched from each provider, cached) ----------

interface CacheEntry {
  at: number
  models: CatalogModel[]
  /** false = this is a raw catalog whose usability probe hasn't finished yet */
  probed?: boolean
}

// Bump when the cached shape or the derived data (context heuristics, provider
// set) changes, so an upgrade refetches once instead of showing stale numbers
// (e.g. the old flat 8K context for OpenAI-compatible models).
const CACHE_VERSION = 4

interface CacheFile {
  v: number
  models: Record<string, CacheEntry>
}

// Re-check each provider at most every 6h. Longer than before because every
// refresh now probes each model for usability (a real tiny request per model);
// 6h keeps that cost/traffic low while still surfacing new models the same day.
// The Settings "↻ Refresh now" button forces an immediate re-check any time.
const CACHE_TTL = 6 * 60 * 60 * 1000
// Ollama Cloud refreshes need one probe request per model against an
// ACCOUNT-wide quota (unlike Google's per-model buckets), so re-check daily.
const OLLAMA_CLOUD_TTL = 24 * 60 * 60 * 1000
const FETCH_TIMEOUT = 6000

const isOllamaCloud = (p: ProviderInfo): boolean =>
  (p.baseURL ?? '').includes('ollama.com')

let liveCache: Record<string, CacheEntry> | null = null
// Providers currently being re-fetched in the background (stale-while-revalidate),
// so we never fire two overlapping refreshes for the same provider.
const refreshing = new Set<string>()

function cachePath(): string {
  return join(app.getPath('userData'), 'models-cache.json')
}

function getCache(): Record<string, CacheEntry> {
  if (liveCache) return liveCache
  try {
    const raw = existsSync(cachePath())
      ? (JSON.parse(readFileSync(cachePath(), 'utf-8')) as CacheFile)
      : null
    // A stale-version (or old flat-format) cache is discarded → refetch once.
    liveCache = raw && raw.v === CACHE_VERSION && raw.models ? raw.models : {}
  } catch {
    liveCache = {}
  }
  return liveCache
}

function saveCache(): void {
  try {
    const file: CacheFile = { v: CACHE_VERSION, models: getCache() }
    writeFileSync(cachePath(), JSON.stringify(file), 'utf-8')
  } catch {
    // cache is best-effort; never break listing over a disk error
  }
}

/** Ask the provider which models exist RIGHT NOW, then hide the ones THIS key
 *  can't actually use. Throws on any listing failure. */
async function fetchLiveModels(p: ProviderInfo): Promise<CatalogModel[]> {
  const key = getKey(p.id) ?? undefined
  const models = await fetchRawModels(p, key)
  // Probe each model with a real minimal request (the SAME engine the chat uses,
  // so we see the exact error the user would) and hide the ones this key can't
  // run — unpaid account, plan doesn't include it, model needs a different API,
  // retired, etc. Needs a key (keyless/local catalogs are all usable); skip huge
  // catalogs where a request-per-model burst isn't worth it.
  if (p.needsKey && key && models.length > 0 && models.length <= MAX_PROBE_MODELS) {
    return filterUsableModels(p.id, models)
  }
  return models
}

/** The raw "what models exist" call per provider kind (no usability filtering). */
async function fetchRawModels(p: ProviderInfo, key: string | undefined): Promise<CatalogModel[]> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT)
  let res: Response
  switch (p.kind) {
    case 'anthropic':
      res = await fetch('https://api.anthropic.com/v1/models?limit=1000', {
        headers: { 'x-api-key': key ?? '', 'anthropic-version': '2023-06-01' },
        signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseAnthropicModels(await res.json())
    case 'openai':
      res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${key}` },
        signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseOpenAIModels(await res.json())
    case 'google':
      res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&key=${encodeURIComponent(key ?? '')}`,
        { signal }
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseGoogleModels(await res.json())
    case 'openai-compat': {
      if (!p.baseURL) throw new Error('no base URL')
      res = await fetch(`${p.baseURL.replace(/\/$/, '')}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseCompatModels(await res.json())
    }
  }
}

// Above this many models we DON'T probe (some aggregators list hundreds — a
// request-per-model burst would be slow and wasteful); those catalogs are shown
// as-is. Comfortably covers every built-in provider's real chat-model count.
const MAX_PROBE_MODELS = 120
const PROBE_TIMEOUT = 9000
const PROBE_BATCH = 6

/**
 * Usable-model filter that works for EVERY provider kind (Anthropic, OpenAI,
 * Google, OpenAI-compatible). For each model it makes one real, tiny request
 * through the app's own model layer (getModel + generateText) — the identical
 * path the chat uses — so the probe sees exactly the error the user would. A
 * model that answers a 1-token "Hi" is kept; one that comes back with a
 * deterministic "you can't use this" error (payment/quota/plan/no-access/
 * unsupported-API/retired) is dropped. Transient or ambiguous failures (bad
 * key, plain rate-limit, timeout, server error) keep the model — we never hide
 * one over a hiccup. Batched with a short gap so we don't trip a rate limit.
 */
async function filterUsableModels(providerId: string, models: CatalogModel[]): Promise<CatalogModel[]> {
  // Lazy imports: `ai` is heavy, and getModel lives in providers.ts which
  // imports back from this file — importing it at call time avoids a load-time
  // circular-dependency edge case.
  const [{ generateText }, { getModel }] = await Promise.all([import('ai'), import('./providers')])
  const drop = new Set<string>()
  for (let i = 0; i < models.length; i += PROBE_BATCH) {
    await Promise.all(
      models.slice(i, i + PROBE_BATCH).map(async (m) => {
        try {
          await generateText({
            model: getModel(providerId, m.modelId),
            prompt: 'Hi',
            maxOutputTokens: 8,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(PROBE_TIMEOUT)
          })
        } catch (err) {
          if (probeErrorVerdict(err) === 'drop') drop.add(m.modelId)
        }
      })
    )
    if (i + PROBE_BATCH < models.length) await new Promise((r) => setTimeout(r, 250))
  }
  return models.filter((m) => !drop.has(m.modelId))
}

// Error-message signals that mean "this account/key genuinely cannot use this
// model" (as opposed to a transient blip). Matched case-insensitively against
// the error message + response body. Kept deliberately specific so a rate-limit
// or network wobble is never mistaken for an unusable model.
const CANT_USE_MESSAGE =
  /insufficient|not enough balance|balance is (?:too )?low|欠费|余额|recharge|top ?up|arrears|arrearage|no resource package|exceeded your (?:current )?quota|check your plan|billing details|your account is not active|not have access|do(?:es)? not have permission|no permission|not authorized|do(?:es)? not exist|only supports?|not supported|unsupported|payment required|please (?:activate|subscribe|purchase|upgrade)|upgrade your plan|free[_ ]tier|billed users?|access denied|model_not_found|invalid_api_model|not allowed to (?:use|access)|no access/i

/**
 * Decide, from a failed probe, whether to HIDE the model ('drop') or keep it
 * ('unknown'/transient). Drop only on high-confidence, deterministic signals:
 *   - HTTP 402 / 403 / 404 (payment required / forbidden / gone), OR
 *   - an error message that plainly states unpaid / out-of-quota / no-access /
 *     wrong-API / retired (see CANT_USE_MESSAGE).
 * Everything else — 401 bad key, plain 429 rate-limit, 5xx, timeouts, param
 * quirks (e.g. a reasoning model rejecting a tiny max_tokens) — keeps the model.
 */
function probeErrorVerdict(err: unknown): 'drop' | 'unknown' {
  const status = probeStatus(err)
  if (status === 402 || status === 403 || status === 404) return 'drop'
  return CANT_USE_MESSAGE.test(probeErrorText(err)) ? 'drop' : 'unknown'
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function probeStatus(err: unknown): number | undefined {
  const e = err as any
  return (
    e?.statusCode ??
    e?.status ??
    e?.response?.status ??
    e?.data?.statusCode ??
    e?.lastError?.statusCode ??
    e?.cause?.statusCode ??
    undefined
  )
}

function probeErrorText(err: unknown): string {
  const e = err as any
  const parts: unknown[] = [e?.message, e?.responseBody, e?.cause?.message, e?.cause?.responseBody]
  if (e?.data) {
    try {
      parts.push(typeof e.data === 'string' ? e.data : JSON.stringify(e.data))
    } catch {
      /* ignore un-stringifiable data */
    }
  }
  if (e?.lastError) parts.push(e.lastError.message, e.lastError.responseBody)
  if (Array.isArray(e?.errors)) for (const sub of e.errors) parts.push(sub?.message, sub?.responseBody)
  return parts.filter((p) => typeof p === 'string').join(' ')
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function toModelInfo(providerId: string, m: CatalogModel): ModelInfo {
  return {
    id: `${providerId}/${m.modelId}`,
    providerId,
    modelId: m.modelId,
    label: m.label,
    contextWindow: m.contextWindow,
    // builtin=true means "not user-added" → Settings shows no remove button
    builtin: true
  }
}

/** Tell every open window the model list changed so pickers update in place. */
function notifyModelsUpdated(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('models:updated')
  }
}

/**
 * Refresh one provider's model list (raw fetch + usability probe) off the
 * critical path, write it to the cache file, and notify the renderer — so
 * nobody ever WAITS on probing, and the picker visibly updates the moment the
 * checked list is ready. De-duped per provider; failures are swallowed (we
 * keep whatever we already returned).
 */
function backgroundRefresh(p: ProviderInfo): void {
  if (refreshing.has(p.id)) return
  refreshing.add(p.id)
  fetchLiveModels(p)
    .then((models) => {
      getCache()[p.id] = { at: Date.now(), models, probed: true }
      saveCache()
      notifyModelsUpdated()
    })
    .catch(() => {
      /* offline / provider hiccup — keep the stale cache */
    })
    .finally(() => refreshing.delete(p.id))
}

/**
 * Models for one provider. NOTHING here ever waits on the (slow, per-model)
 * usability probe — the list call must stay fast so the UI never sits on a
 * stale list:
 *   - fresh, fully-probed cache → return it (no network at all);
 *   - stale or unprobed cache  → return it instantly + refresh/probe in the
 *     background (the renderer gets a models:updated push when it lands);
 *   - no cache (first run / forced refresh) → fetch the RAW catalog now (fast,
 *     one request), return it, and probe in the background — moments later the
 *     picker visibly trims to what this key can actually use;
 *   - fetch failed → last cached list, else nothing (NEVER placeholder models).
 * User-added custom models are always kept and win on conflicts.
 */
async function modelsForProvider(p: ProviderInfo, force: boolean): Promise<ModelInfo[]> {
  const custom = getConfig()
    .customModels.filter((m) => m.providerId === p.id)
    .map((m) => ({ ...m, id: `${p.id}/${m.modelId}`, builtin: false }))

  // No key saved → the user can't use ANY of this provider's models, so don't
  // list them (a keyless provider simply doesn't appear in the picker). Only
  // models the user hand-added stay. Add a key in Providers to unlock the rest.
  if (p.needsKey && !p.hasKey) return dedupe([...custom])

  const cache = getCache()
  const cached = cache[p.id]
  const ttl = isOllamaCloud(p) ? OLLAMA_CLOUD_TTL : CACHE_TTL
  const fresh = cached && Date.now() - cached.at < ttl
  let live: CatalogModel[] | null

  if (!force && fresh && cached.probed !== false) {
    // Fresh, fully-probed cache → use it, no network at all.
    live = cached.models
  } else if (!force && cached) {
    // Stale (or interrupted-probe) cache → return it INSTANTLY and refresh +
    // probe in the background; models:updated tells the UI when it's done.
    live = cached.models
    backgroundRefresh(p)
  } else {
    // No cache yet (first run for this provider) or a forced Settings refresh:
    // fetch the RAW catalog now — one fast request — and kick the usability
    // probe off in the background so this call returns immediately.
    try {
      const key = getKey(p.id) ?? undefined
      live = await fetchRawModels(p, key)
      const probeNeeded = p.needsKey && !!key && live.length > 0 && live.length <= MAX_PROBE_MODELS
      cache[p.id] = { at: Date.now(), models: live, probed: !probeNeeded }
      saveCache()
      if (probeNeeded) backgroundRefresh(p)
    } catch {
      live = cached?.models ?? null // offline / bad key / hiccup → last known list, else nothing
    }
  }

  // The probed list only contains models THIS key can actually use, so no
  // manual free/paid plan setting is needed. Custom models are always kept.
  const liveInfos = live ? live.map((m) => toModelInfo(p.id, m)) : []
  return dedupe([...custom, ...liveInfos])
}

function dedupe(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>()
  return models.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
}

/**
 * All models across providers, live where possible. `force` bypasses the
 * cache (Settings "refresh" button). Local Ollama models are NOT included
 * here — the renderer merges detectOllama() results itself.
 */
export async function listModels(force = false): Promise<ModelInfo[]> {
  const providers = listProviders().filter((p) => p.id !== 'ollama')
  const perProvider = await Promise.all(
    providers.map((p) =>
      // belt & braces: a provider that errors contributes nothing (never fakes)
      modelsForProvider(p, force).catch(() => [] as ModelInfo[])
    )
  )
  return perProvider.flat()
}

export async function detectOllama(): Promise<OllamaStatus> {
  const url = getConfig().ollamaUrl
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { running: false, url, models: [] }
    const data = (await res.json()) as { models?: { name: string }[] }
    const models: ModelInfo[] = (data.models ?? []).map((m) => ({
      id: `ollama/${m.name}`,
      modelId: m.name,
      providerId: 'ollama',
      label: m.name,
      contextWindow: DEFAULT_OLLAMA_CONTEXT,
      builtin: false
    }))
    return { running: true, url, models }
  } catch {
    return { running: false, url, models: [] }
  }
}
