// Lightweight renderer-side preferences (localStorage).

import type { ModelInfo } from '../../shared/types'

const LAST_MODEL = 'orbit-last-model'
const FAVORITES = 'orbit-favorite-models'

/** Remember the model the user last picked, so new chats default to it. */
export function setLastModel(id: string): void {
  localStorage.setItem(LAST_MODEL, id)
}

/**
 * The model a new chat should start on: the last one the user used if it's
 * still available, otherwise the first model in the list.
 */
export function pickDefaultModel(models: ModelInfo[]): ModelInfo | undefined {
  if (models.length === 0) return undefined
  const last = localStorage.getItem(LAST_MODEL)
  return models.find((m) => m.id === last) ?? models[0]
}

// ---------- Favourite models (starred; shown at the top of the picker) ----------

export function getFavoriteModels(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVORITES) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function isFavoriteModel(id: string): boolean {
  return getFavoriteModels().includes(id)
}

/** Toggle a model's favourite state; returns the new full list. */
export function toggleFavoriteModel(id: string): string[] {
  const cur = getFavoriteModels()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  localStorage.setItem(FAVORITES, JSON.stringify(next))
  return next
}
