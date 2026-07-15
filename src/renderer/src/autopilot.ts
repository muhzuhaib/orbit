// Autopilot (v0.10.0-beta.1): smart model routing.
//
// When a conversation is in Autopilot, each outgoing message is classified
// easy / medium / hard and routed to an appropriate model the user can actually
// use — easy → a free/fast model, hard → their most capable model. A fast
// heuristic decides first; an optional 1-call classification by a cheap model
// can refine it (toggleable). All state lives in NEW localStorage keys, so
// reverting to v0.9.3 leaves everything working.

import type { ModelInfo } from '../../shared/types'
import { classifyModel } from '../../shared/modelCatalog'
import { modelPrice } from '../../shared/modelPricing'

/** Virtual model id shown at the top of the picker when Autopilot is available. */
export const AUTOPILOT_ID = 'autopilot/auto'

export type Difficulty = 'easy' | 'medium' | 'hard'

// ---------- difficulty (fast heuristic) ----------

// Signals that a request needs real reasoning power.
const HARD_HINTS =
  /\b(prove|proof|derive|optimi[sz]e|complexity|algorithm|refactor|architect|debug|why does|analy[sz]e|theorem|integral|differential|regex|concurren|race condition|security|vulnerab|trade-?offs?|design a|reason through|step by step|edge cases?)\b/i
const EASY_HINTS =
  /\b(hi|hey|hello|thanks|thank you|what is|define|meaning of|translate|spelling|synonym|capital of|convert|list of|how do you spell|say|rewrite this|shorten|summari[sz]e in one)\b/i
const CODE_FENCE = /```|\bfunction\b|\bclass\b|\bimport\b|=>|;\s*$/m

/** Classify a message with a cheap, instant heuristic (no model call). */
export function heuristicDifficulty(text: string, priorMessages = 0): Difficulty {
  const t = text.trim()
  const len = t.length
  let score = 0 // negative → easier, positive → harder

  if (HARD_HINTS.test(t)) score += 2
  if (EASY_HINTS.test(t) && len < 200) score -= 2
  if (CODE_FENCE.test(t)) score += 1
  if (len > 600) score += 1
  if (len > 1500) score += 1
  if (len < 60) score -= 1
  // long-running conversations tend to accumulate hard context
  if (priorMessages >= 8) score += 1

  if (score >= 2) return 'hard'
  if (score <= -2) return 'easy'
  return 'medium'
}

// ---------- capability & price ranking ----------

// Rough capability tier from the model name (0–100). Local/free models can be
// very capable (e.g. a 480B), so we don't rely on price for capability.
function capabilityScore(m: ModelInfo): number {
  const id = m.modelId.toLowerCase()
  const big =
    /(opus|gpt-5(?!-(mini|nano))|(?<![a-z])o[13](?!-mini)|-pro|\bmax\b|405b|480b|235b|70b|72b|120b|reasoner|\br1\b|deepseek-v3|large|ultra|sonnet-4|3\.7-sonnet)/
  const small =
    /(mini|nano|lite|flash|haiku|turbo|\bair\b|small|1\.5b|\b[1-9]b\b|gemma|tiny|instant|8b)/
  let s = 50
  if (big.test(id)) s = 92
  else if (small.test(id)) s = 28
  // sonnet / gpt-4o / 4.1 / plus / glm-4 sit in the middle by default (50)
  if (classifyModel(m.modelId) === 'thinking') s += 6
  // context window as a minor tiebreaker
  s += Math.min(6, Math.round(m.contextWindow / 200_000))
  return s
}

/** Output $/1M for a model (0 for free/local, a big number for unknown so it never wins "cheapest"). */
function outRate(m: ModelInfo): number {
  const p = modelPrice(m.providerId, m.modelId)
  return p ? p.output : 5 // unknown → treat as mid-priced
}

function isFree(m: ModelInfo): boolean {
  const p = modelPrice(m.providerId, m.modelId)
  return p != null && p.input === 0 && p.output === 0
}

/** The most capable model available (the "best model I have"). */
export function bestModel(models: ModelInfo[]): ModelInfo | null {
  const list = usable(models)
  if (list.length === 0) return null
  return [...list].sort((a, b) => capabilityScore(b) - capabilityScore(a) || outRate(b) - outRate(a))[0]
}

/** A free/fast model for easy work (prefers free + fast, else cheapest). */
export function fastModel(models: ModelInfo[]): ModelInfo | null {
  const list = usable(models)
  if (list.length === 0) return null
  const rank = (m: ModelInfo): number => {
    let r = outRate(m) // cheaper is better
    if (isFree(m)) r -= 100
    if (classifyModel(m.modelId) === 'fast') r -= 10
    return r
  }
  return [...list].sort((a, b) => rank(a) - rank(b))[0]
}

/** A mid-tier model: the median by capability. */
export function midModel(models: ModelInfo[]): ModelInfo | null {
  const list = usable(models).sort((a, b) => capabilityScore(a) - capabilityScore(b))
  if (list.length === 0) return null
  return list[Math.floor((list.length - 1) / 2)]
}

/** The most expensive model (baseline for "saved $X vs your priciest model"). */
export function priciestModel(models: ModelInfo[]): ModelInfo | null {
  const list = usable(models)
  if (list.length === 0) return null
  return [...list].sort((a, b) => outRate(b) - outRate(a))[0]
}

function usable(models: ModelInfo[]): ModelInfo[] {
  return models.filter((m) => m.providerId !== 'autopilot')
}

/** Route a difficulty to a concrete model from the usable set. */
export function routeModel(difficulty: Difficulty, models: ModelInfo[]): ModelInfo | null {
  if (difficulty === 'hard') return bestModel(models)
  if (difficulty === 'easy') return fastModel(models)
  return midModel(models) ?? bestModel(models)
}

// ---------- classifier helper settings ----------

export interface AutopilotSettings {
  /** run one extra cheap-model call to refine the heuristic */
  useClassifier: boolean
  /** `${providerId}/${modelId}` of the cheap classifier, or '' for auto-pick */
  classifierId: string
}

const SETTINGS_KEY = 'orbit-autopilot-settings'

export function getAutopilotSettings(): AutopilotSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) return { useClassifier: false, classifierId: '', ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return { useClassifier: false, classifierId: '' }
}

export function setAutopilotSettings(s: AutopilotSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

/** Pick a good default cheap classifier: Gemini Flash-Lite, else a free/local model, else the cheapest. */
export function defaultClassifier(models: ModelInfo[]): ModelInfo | null {
  const list = usable(models)
  const flashLite = list.find((m) => /flash-lite/i.test(m.modelId) && m.providerId === 'google')
  if (flashLite) return flashLite
  const local = list.find((m) => isFree(m))
  return local ?? fastModel(models)
}

// ---------- cumulative savings ----------

const SAVINGS_KEY = 'orbit-autopilot-savings'

export function getAutopilotSavings(): number {
  const v = parseFloat(localStorage.getItem(SAVINGS_KEY) ?? '0')
  return Number.isFinite(v) ? v : 0
}

export function addAutopilotSavings(usd: number): void {
  if (!(usd > 0)) return
  localStorage.setItem(SAVINGS_KEY, String(getAutopilotSavings() + usd))
  window.dispatchEvent(new CustomEvent('orbit-autopilot-savings'))
}
