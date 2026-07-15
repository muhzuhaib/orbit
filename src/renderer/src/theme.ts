// App theme (light / dark). Persisted in localStorage; falls back to the OS
// preference on first run. Applied by stamping data-theme on <html>.

export type Theme = 'light' | 'dark'

const KEY = 'orbit-theme'

export function getStoredTheme(): Theme {
  const saved = localStorage.getItem(KEY)
  if (saved === 'light' || saved === 'dark') return saved
  // New users start in dark mode (the app's default look). Once they pick a
  // theme with the toggle, that choice is remembered instead.
  return 'dark'
}

export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute('data-theme', theme)
}

export function setStoredTheme(theme: Theme): void {
  localStorage.setItem(KEY, theme)
  applyTheme(theme)
}

// Apply immediately on import so the first paint is already themed.
applyTheme(getStoredTheme())
