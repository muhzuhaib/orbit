// Recent side-by-side comparisons, saved locally so the Compare view can show a
// short history. Only the last few are kept (comparisons are otherwise
// ephemeral). Renderer-only — no main-process storage needed.

export interface CompareHistoryEntry {
  id: string
  at: number
  /** display labels for each column, e.g. "Claude Opus 4.8" */
  models: string[]
  turns: { user: string; answers: string[] }[]
}

const KEY = 'orbit-compare-history'
const MAX = 3

export function getCompareHistory(): CompareHistoryEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

/** Save (or update) a comparison snapshot; keeps only the most recent MAX. */
export function saveCompareHistory(entry: CompareHistoryEntry): CompareHistoryEntry[] {
  const rest = getCompareHistory().filter((e) => e.id !== entry.id)
  const next = [entry, ...rest].slice(0, MAX)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearCompareHistory(): void {
  localStorage.removeItem(KEY)
}
