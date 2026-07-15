// Runtime "circuit breaker" for rate-limited / quota-exhausted models.
//
// The one-time usability probe (registry.ts) can only catch models an account
// PERMANENTLY can't call — it sends a single request, so a free-tier model that
// works for a few prompts then hits its requests-per-minute / per-day quota
// sails through. This tracks REAL chat outcomes per model: after a couple of
// consecutive rate-limit/quota errors a model is flagged "rate-limited" for a
// cool-down window, and the picker greys + demotes it (never deletes it — the
// user may just need to wait). A single success clears the flag immediately.

import { BrowserWindow } from 'electron'

const RATE_LIMIT_THRESHOLD = 2 // consecutive rate-limit errors before we flag it
const COOLDOWN_MS = 20 * 60 * 1000 // stay flagged this long, then auto-clear

interface Health {
  fails: number
  /** epoch ms the flag lifts; 0 = counting but not yet flagged */
  until: number
}

const state = new Map<string, Health>()

function broadcast(): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('models:health')
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function errStatus(err: unknown): number | undefined {
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

function errText(err: unknown): string {
  const e = err as any
  const parts: unknown[] = [e?.message, e?.responseBody, e?.cause?.message, e?.cause?.responseBody]
  if (e?.lastError) parts.push(e.lastError.message, e.lastError.responseBody)
  return parts.filter((p) => typeof p === 'string').join(' ')
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** True when a chat failure is a rate-limit / free-tier-quota error (429 /
 *  RESOURCE_EXHAUSTED / "quota" / "rate limit"), as opposed to a real bug. */
export function isRateLimitError(err: unknown): boolean {
  if (errStatus(err) === 429) return true
  // Also treat per-minute token limits ("TPM", "request too large … tokens per
  // minute", "reduce your message size") as rate-limit-class — these are free-tier
  // throughput caps (e.g. Groq's 8000 TPM) that clear after a short wait.
  return /rate.?limit|too many requests|resource[_ ]?exhausted|exceeded your (?:current )?quota|quota (?:exceeded|exhausted)|tokens per minute|\bTPM\b|request too large|reduce your message size|\b429\b/i.test(
    errText(err)
  )
}

/** Record the outcome of a real chat turn for `providerId/modelId`. */
export function recordModelResult(modelKey: string, ok: boolean, err?: unknown): void {
  if (ok) {
    if (state.delete(modelKey)) broadcast()
    return
  }
  if (!isRateLimitError(err)) return
  const h = state.get(modelKey) ?? { fails: 0, until: 0 }
  h.fails += 1
  if (h.fails >= RATE_LIMIT_THRESHOLD) h.until = Date.now() + COOLDOWN_MS
  state.set(modelKey, h)
  broadcast()
}

/** Currently-flagged models → the epoch ms their cool-down lifts. Expired
 *  entries are cleaned up on read. */
export function rateLimitedModels(): Record<string, number> {
  const now = Date.now()
  const out: Record<string, number> = {}
  let changed = false
  for (const [key, h] of state) {
    if (h.until > now) out[key] = h.until
    else if (h.until && h.until <= now) {
      state.delete(key)
      changed = true
    }
  }
  if (changed) broadcast()
  return out
}
