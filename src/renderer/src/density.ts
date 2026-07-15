// UI density (Comfortable / Compact). Persisted in localStorage; applied by
// stamping data-density on <html>. Compact tightens the spacing scale + reading
// type so more fits on screen (styles.css reads [data-density='compact']).

export type Density = 'comfortable' | 'compact'

const KEY = 'orbit-density'

export function getStoredDensity(): Density {
  const saved = localStorage.getItem(KEY)
  return saved === 'compact' ? 'compact' : 'comfortable'
}

export function applyDensity(density: Density): void {
  document.documentElement.setAttribute('data-density', density)
}

export function setStoredDensity(density: Density): void {
  localStorage.setItem(KEY, density)
  applyDensity(density)
}

// Apply immediately on import so the first paint uses the chosen density.
applyDensity(getStoredDensity())
