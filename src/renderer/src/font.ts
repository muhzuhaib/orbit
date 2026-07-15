// App font family. Persisted in localStorage; applied by setting the --app-font
// CSS variable on <html>. Only system-available font stacks are used (the app
// runs offline — no web fonts to download).

export interface FontOption {
  id: string
  label: string
  /** CSS font-family stack; empty = fall back to the stylesheet default */
  stack: string
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'system', label: 'System (default)', stack: "'Segoe UI', system-ui, sans-serif" },
  { id: 'inter', label: 'Neutral sans', stack: "'Helvetica Neue', Arial, sans-serif" },
  { id: 'readable', label: 'Readable (Verdana)', stack: "Verdana, Tahoma, Geneva, sans-serif" },
  { id: 'serif', label: 'Serif (Georgia)', stack: "Georgia, 'Times New Roman', serif" },
  { id: 'mono', label: 'Monospace', stack: "'Cascadia Code', Consolas, 'Courier New', monospace" }
]

const KEY = 'orbit-font'

export function getStoredFont(): string {
  const saved = localStorage.getItem(KEY)
  return FONT_OPTIONS.some((f) => f.id === saved) ? (saved as string) : 'system'
}

export function applyFont(id: string): void {
  const opt = FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0]
  document.documentElement.style.setProperty('--app-font', opt.stack)
}

export function setStoredFont(id: string): void {
  localStorage.setItem(KEY, id)
  applyFont(id)
}

// Apply immediately on import so the first paint uses the chosen font.
applyFont(getStoredFont())
