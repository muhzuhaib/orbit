// User-selectable accent colour. The theme already drives every accent through
// CSS variables (--accent + --accent-soft), so a picker just overrides those on
// <html>. Persisted in localStorage; applies to BOTH light and dark themes.
// Value is either 'default' (clear the override → theme decides) or a hex colour.

export interface AccentOption {
  id: string
  label: string
  /** Hex colour applied to both themes, or null for the theme default. */
  color: string | null
}

export const ACCENT_OPTIONS: AccentOption[] = [
  { id: 'default', label: 'Default', color: null },
  { id: 'violet', label: 'Violet', color: '#8b7cf0' },
  { id: 'emerald', label: 'Emerald', color: '#3fb27f' },
  { id: 'rose', label: 'Rose', color: '#e8688f' },
  { id: 'amber', label: 'Amber', color: '#d9a441' },
  { id: 'cyan', label: 'Cyan', color: '#4bb6c9' },
  { id: 'coral', label: 'Coral', color: '#e5795b' }
]

const KEY = 'orbit-accent'

/** Returns 'default' or a hex string. */
export function getStoredAccent(): string {
  const saved = localStorage.getItem(KEY)
  if (!saved) return 'default'
  if (saved === 'default') return 'default'
  return /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : 'default'
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export function applyAccent(value: string): void {
  const root = document.documentElement
  if (value === 'default' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    // Fall back to the stylesheet's per-theme accent.
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-soft')
    return
  }
  root.style.setProperty('--accent', value)
  root.style.setProperty('--accent-soft', hexToRgba(value, 0.16))
}

export function setStoredAccent(value: string): void {
  localStorage.setItem(KEY, value)
  applyAccent(value)
}

// Apply immediately on import so the first paint already uses the chosen accent.
applyAccent(getStoredAccent())
