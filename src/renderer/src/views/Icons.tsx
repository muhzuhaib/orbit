// Minimalist line-icon set. All icons inherit `currentColor` and use a
// consistent 1.75 stroke, so they read as one family across the app.
import type { JSX } from 'react'

type P = { className?: string }

const S = ({ children, className }: { children: JSX.Element | JSX.Element[]; className?: string }) => (
  <svg
    className={className ?? 'icon'}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.75}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
)

export const ChatIcon = (p: P) => (
  <S className={p.className}>
    <path d="M4 5h16v11H8l-4 3.5V5Z" />
  </S>
)

// Sidebar toggle: a panel with a divided-off left column. Used for both the
// hide (sidebar shown) and show (sidebar hidden) buttons.
export const PanelLeftIcon = (p: P) => (
  <S className={p.className}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </S>
)

export const FolderIcon = (p: P) => (
  <S className={p.className}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4l2 2.5h7A1.5 1.5 0 0 1 19 9v8.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5V6.5Z" />
  </S>
)

// Assistant (internal id "cowork") nav icon: a simple, minimalist briefcase —
// rounded body, a handle on top, and a thin divider across the middle.
export const CoworkIcon = (p: P) => (
  <S className={p.className}>
    <rect x="3" y="7" width="18" height="13" rx="2.5" />
    <path d="M8.5 7V5.75A1.75 1.75 0 0 1 10.25 4h3.5A1.75 1.75 0 0 1 15.5 5.75V7" />
    <path d="M3 13h18" />
  </S>
)

// A proper cog silhouette (not the old spoked circle, which read as a sun and
// looked like the light/dark toggle). Ring of teeth + centre hole.
export const SettingsIcon = (p: P) => (
  <S className={p.className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </S>
)

export const PlusIcon = (p: P) => (
  <S className={p.className}>
    <path d="M12 5v14M5 12h14" />
  </S>
)

export const SendIcon = (p: P) => (
  <S className={p.className}>
    <path d="M4 12l16-7-7 16-2.5-6.5L4 12Z" />
  </S>
)

export const StopIcon = (p: P) => (
  <S className={p.className}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </S>
)

export const AttachIcon = (p: P) => (
  <S className={p.className}>
    <path d="M8 12l6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l8-8" />
  </S>
)

export const CameraIcon = (p: P) => (
  <S className={p.className}>
    <path d="M4 8h3l1.5-2h7L18 8h2a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="12.5" r="3" />
  </S>
)

export const RefreshIcon = (p: P) => (
  <S className={p.className}>
    <path d="M4 12a8 8 0 0 1 13.5-5.8L20 8M20 4v4h-4M20 12a8 8 0 0 1-13.5 5.8L4 16M4 20v-4h4" />
  </S>
)

export const CloseIcon = (p: P) => (
  <S className={p.className}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
)

export const ChevronDownIcon = (p: P) => (
  <S className={p.className}>
    <path d="M6 9l6 6 6-6" />
  </S>
)

export const SunIcon = (p: P) => (
  <S className={p.className}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
  </S>
)

export const MoonIcon = (p: P) => (
  <S className={p.className}>
    <path d="M20 13.5A8 8 0 0 1 10.5 4a7 7 0 1 0 9.5 9.5Z" />
  </S>
)

export const BrainIcon = (p: P) => (
  <S className={p.className}>
    <path d="M9 4.5A2.5 2.5 0 0 0 6.5 7 2.5 2.5 0 0 0 5 12a2.5 2.5 0 0 0 1.5 4.5A2.5 2.5 0 0 0 9 19.5c1 0 1.5-.6 1.5-1.5V6c0-.9-.5-1.5-1.5-1.5ZM15 4.5A2.5 2.5 0 0 1 17.5 7 2.5 2.5 0 0 1 19 12a2.5 2.5 0 0 1-1.5 4.5A2.5 2.5 0 0 1 15 19.5c-1 0-1.5-.6-1.5-1.5V6c0-.9.5-1.5 1.5-1.5Z" />
  </S>
)

export const BoltIcon = (p: P) => (
  <S className={p.className}>
    <path d="M13 3L5 13h5l-1 8 8-10h-5l1-8Z" />
  </S>
)

export const TrashIcon = (p: P) => (
  <S className={p.className}>
    <path d="M5 7h14M10 7V5h4v2M6 7l1 12h10l1-12" />
  </S>
)

export const SearchIcon = (p: P) => (
  <S className={p.className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4-4" />
  </S>
)

export const CompareIcon = (p: P) => (
  <S className={p.className}>
    <rect x="3.5" y="5" width="7" height="14" rx="1.5" />
    <rect x="13.5" y="5" width="7" height="14" rx="1.5" />
  </S>
)

export const TemplateIcon = (p: P) => (
  <S className={p.className}>
    <path d="M6 3h9l4 4v14H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M14 3v5h5M8.5 12h7M8.5 15.5h7" />
  </S>
)

export const StarIcon = (p: P) => (
  <S className={p.className}>
    <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 17.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5Z" />
  </S>
)

export const StarFilledIcon = (p: P) => (
  <svg className={p.className ?? 'icon'} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 3.5l2.6 5.3 5.9.9-4.25 4.15 1 5.85L12 17.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9L12 3.5Z" />
  </svg>
)

export const PinIcon = (p: P) => (
  <S className={p.className}>
    <path d="M9 3h6l-1 6 3 3H7l3-3-1-6ZM12 15v6" />
  </S>
)

export const MicIcon = (p: P) => (
  <S className={p.className}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
  </S>
)

export const SpeakerIcon = (p: P) => (
  <S className={p.className}>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" />
    <path d="M16 9a3.5 3.5 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11" />
  </S>
)

export const CopyIcon = (p: P) => (
  <S className={p.className}>
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </S>
)

export const EditIcon = (p: P) => (
  <S className={p.className}>
    <path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.2V20Z" />
    <path d="M14 6.5l3.5 3.5" />
  </S>
)

export const GlobeIcon = (p: P) => (
  <S className={p.className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.5 2.4 3.8 5.4 3.8 8.5S14.5 18 12 20.5C9.5 18 8.2 15 8.2 12S9.5 6 12 3.5Z" />
  </S>
)

export const CoinIcon = (p: P) => (
  <S className={p.className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v10M14.5 9.2c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.8-2.5 1.9 0 2.6 5 1.3 5 3.9 0 1.1-1.1 1.9-2.5 1.9-1 0-1.9-.3-2.5-1" />
  </S>
)

export const DotsIcon = (p: P) => (
  <S className={p.className}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </S>
)

/** Orbit brand mark: two overlapping squares (one axis-aligned, one rotated to a
    diamond) forming an 8-point geometric star, with a nucleus + a satellite dot.
    Purely straight-edged — no ovals. */
export const OrbitMark = (p: P) => (
  <svg className={p.className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect x="6" y="6" width="12" height="12" rx="1.6" stroke="currentColor" strokeWidth={1.6} />
    <rect
      x="6"
      y="6"
      width="12"
      height="12"
      rx="1.6"
      transform="rotate(45 12 12)"
      stroke="currentColor"
      strokeWidth={1.6}
    />
    <circle cx="12" cy="12" r="1.9" fill="currentColor" />
    <circle cx="16.7" cy="7.3" r="1.5" fill="currentColor" />
  </svg>
)

/** Swarm nav icon: a lead hub coordinating three worker nodes (hub-and-spoke). */
export const SwarmIcon = (p: P) => (
  <S className={p.className}>
    <path d="M12 12L5.5 6M12 12l6.5-6M12 12v7.5" />
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="5" cy="5" r="1.8" />
    <circle cx="19" cy="5" r="1.8" />
    <circle cx="12" cy="20" r="1.8" />
  </S>
)

/** Studio (design) nav icon: a browser/canvas frame with a sparkle. */
export const StudioIcon = (p: P) => (
  <S className={p.className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 8h18" />
    <path d="M13.5 15l1-2.2 1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1Z" />
  </S>
)

/** Forge (Claude Code clone) nav icon: a developer terminal prompt. */
export const ForgeIcon = (p: P) => (
  <S className={p.className}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M7 10l2.5 2L7 14" />
    <path d="M12.5 15h4.5" />
  </S>
)

/** Providers nav icon: a power plug (connect your AI accounts). */
export const PlugIcon = (p: P) => (
  <S className={p.className}>
    <path d="M9 2v5M15 2v5" />
    <path d="M6.5 7h11v3a5.5 5.5 0 0 1-11 0V7Z" />
    <path d="M12 15.5V22" />
  </S>
)

// Animated "working" indicator (three bouncing dots). Shown whenever an agent or
// model is busy but not yet streaming visible text, so activity is always visible.
export const WorkingDots = ({ label }: { label?: string }) => (
  <span className="working-pill">
    <span className="working-dots" aria-label={label ?? 'Working'}>
      <i />
      <i />
      <i />
    </span>
    {label && <span>{label}</span>}
  </span>
)
