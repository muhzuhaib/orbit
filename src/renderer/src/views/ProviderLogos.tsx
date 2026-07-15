// Built-in provider logos. These are inline SVGs (no network requests, no image
// files) so they render instantly and never slow the app down — exactly what we
// want on the Providers screen. Each brand mark sits on its own white tile in
// ProvidersView. Where we don't have a distinct mark for a provider, ProviderLogo
// returns null and the caller falls back to a coloured initial tile.
import type { JSX } from 'react'

const Tile =({ children }: { children: JSX.Element | JSX.Element[] }): JSX.Element => (
  <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
    {children}
  </svg>
)

// Anthropic (Claude) — terracotta 8-point spark (two overlaid 4-point stars).
const Anthropic = (): JSX.Element => {
  const star = 'M12 2c.35 4.85 4.8 9.3 9.65 9.65C16.8 12 12.35 16.45 12 21.3 11.65 16.45 7.2 12 2.35 11.65 7.2 11.3 11.65 6.85 12 2Z'
  return (
    <Tile>
      <path d={star} fill="#cc785c" />
      <path d={star} fill="#cc785c" transform="rotate(45 12 12)" opacity="0.9" />
    </Tile>
  )
}

// OpenAI (ChatGPT) — the official interlocking-knot mark.
const OpenAI = (): JSX.Element => (
  <Tile>
    <path
      fill="#0d0d0d"
      d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .75 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.07zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.79.79 0 0 0 .39-.68v-6.74l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.5 4.5zm-9.66-4.13a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.49 4.49 0 0 1 2.37-1.98v5.68a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86-5.84-3.4L15.12 7.2a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1v-5.68a.79.79 0 0 0-.4-.67zm2.01-3.02-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08L8.7 5.46a.79.79 0 0 0-.39.68zm1.1-2.37 2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5z"
    />
  </Tile>
)

// Google (Gemini) — the four-point spark with Google's blue→purple→red sweep.
const Gemini = (): JSX.Element => (
  <Tile>
    <defs>
      <linearGradient id="orbit-gemini" x1="2" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#4285f4" />
        <stop offset="0.52" stopColor="#9b72cb" />
        <stop offset="1" stopColor="#d96570" />
      </linearGradient>
    </defs>
    <path
      d="M12 2c.4 5.2 4.4 9.2 9.6 9.6C16.4 12 12.4 16 12 21.2 11.6 16 7.6 12 2.4 11.6 7.6 11.2 11.6 7.2 12 2Z"
      fill="url(#orbit-gemini)"
    />
  </Tile>
)

// Kimi (Moonshot) — a crescent moon (moon-shot).
const Kimi = (): JSX.Element => (
  <Tile>
    <path d="M20 14.5A8.5 8.5 0 1 1 12 3.2a6.8 6.8 0 0 0 8 11.3Z" fill="#111827" />
  </Tile>
)

// Ollama — the llama mascot silhouette (two ears, rounded head + neck, loaf-shaped
// body, two legs). Monochrome, matching Ollama's own minimalist black mark.
const Ollama = (): JSX.Element => (
  <Tile>
    <g fill="#0b0b0b">
      {/* ears */}
      <path d="M6.7 2.4c.63 0 1.15.68 1.15 1.5V6.2H5.55V3.9c0-.82.52-1.5 1.15-1.5Z" />
      <path d="M10.5 2.4c.63 0 1.15.68 1.15 1.5V6.2H9.35V3.9c0-.82.52-1.5 1.15-1.5Z" />
      {/* head */}
      <circle cx="8.55" cy="7.4" r="3.05" />
      {/* neck */}
      <rect x="6.85" y="7.1" width="3.4" height="7.2" rx="1.7" />
      {/* body */}
      <rect x="6.5" y="11.2" width="11.6" height="8.3" rx="3.9" />
      {/* front + back legs */}
      <rect x="8.5" y="17.8" width="2.05" height="4" rx="1" />
      <rect x="14.6" y="17.8" width="2.05" height="4" rx="1" />
    </g>
  </Tile>
)

// DeepSeek — its blue whale, simplified.
const DeepSeek = (): JSX.Element => (
  <Tile>
    <path
      d="M2.6 10.2c3.4-1 6.8-1 10.2.1 2 .6 3.9.4 5.7-.7l2.9-1.8-.7 3.4c-.6 2.9-3.1 5-6.1 5H8.4a5.8 5.8 0 0 1-5.8-6Z"
      fill="#4d6bfe"
    />
    <circle cx="7.4" cy="12" r="1" fill="#fff" />
  </Tile>
)

// providerId → logo component. Missing ids fall back to the coloured initial.
const LOGOS: Record<string, () => JSX.Element> = {
  anthropic: Anthropic,
  openai: OpenAI,
  google: Gemini,
  kimi: Kimi,
  deepseek: DeepSeek,
  ollama: Ollama,
  'ollama-cloud': Ollama
}

export function hasProviderLogo(id: string): boolean {
  return id in LOGOS
}

export function ProviderLogo({ id, className }: { id: string; className?: string }): JSX.Element | null {
  const Logo = LOGOS[id]
  if (!Logo) return null
  return (
    <span className={className ?? 'prov-logo'}>
      <Logo />
    </span>
  )
}
