import { useEffect, useState, type ComponentType } from 'react'
import SettingsView from './views/SettingsView'
import ProvidersView from './views/ProvidersView'
import ChatsView from './views/ChatsView'
import ProjectsView from './views/ProjectsView'
import CoworkView from './views/CoworkView'
import ForgeView from './views/ForgeView'
import SwarmView from './views/SwarmView'
import StudioView from './views/StudioView'
import CompareView from './views/CompareView'
import CommandPalette from './views/CommandPalette'
import Tooltips from './views/Tooltip'
import UpdateBanner from './views/UpdateBanner'
import {
  ChatIcon,
  CompareIcon,
  CoworkIcon,
  ForgeIcon,
  FolderIcon,
  MoonIcon,
  OrbitMark,
  PanelLeftIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  StudioIcon,
  SunIcon,
  SwarmIcon
} from './views/Icons'
import { getStoredTheme, setStoredTheme, type Theme } from './theme'
import { useBetaFlag } from './betaFlags'

export type View =
  | 'chats'
  | 'projects'
  | 'compare'
  | 'cowork'
  | 'forge'
  | 'swarm'
  | 'studio'
  | 'providers'
  | 'settings'

// Settings is special: it opens as a popup modal (see settingsOpen) rather than
// replacing the main view, so clicking it never leaves your current screen.
// Note: 'cowork' and 'swarm' are the internal view ids (and storage dirs) — kept
// as-is for compatibility — but shown to the user as "Assistant" and "Team".
const NAV: { id: View; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: 'chats', label: 'Chats', icon: ChatIcon },
  { id: 'projects', label: 'Projects', icon: FolderIcon },
  { id: 'cowork', label: 'Assistant', icon: CoworkIcon },
  { id: 'forge', label: 'Code', icon: ForgeIcon },
  { id: 'studio', label: 'Studio', icon: StudioIcon },
  { id: 'swarm', label: 'Team', icon: SwarmIcon },
  { id: 'compare', label: 'Compare', icon: CompareIcon },
  { id: 'providers', label: 'Providers', icon: PlugIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon }
]

export default function App() {
  const [view, setView] = useState<View>('chats')
  const [version, setVersion] = useState('')
  const [chatToOpen, setChatToOpen] = useState<string | null>(null)
  // Full-width (sidebar hidden) is the default for new users; once they show the
  // sidebar with the toggle we store '0' and honour that choice from then on.
  const [navHidden, setNavHidden] = useState(() => localStorage.getItem('orbit-nav-hidden') !== '0')
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme())
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const railOn = useBetaFlag('section-rail')

  const toggleNav = () =>
    setNavHidden((h) => {
      localStorage.setItem('orbit-nav-hidden', h ? '0' : '1')
      return !h
    })

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setStoredTheme(next)
    setTheme(next)
  }

  useEffect(() => {
    // window.api is absent when the renderer is opened in a plain browser
    window.api?.getVersion().then(setVersion)
  }, [])

  // Keep the native title-bar overlay colours in sync with the app theme so the
  // top window strip always matches the app body.
  useEffect(() => {
    window.api?.setTitlebarTheme?.(theme === 'dark')
  }, [theme])

  const openConversation = (id: string) => {
    // force ChatsView to re-open even if the id matches a previous one
    setChatToOpen(null)
    setTimeout(() => setChatToOpen(id), 0)
    setView('chats')
  }

  // New chat = show the empty landing composer in Chats (no throwaway
  // conversation is created; the real one is made when the first message is
  // sent). The '__new__' sentinel tells ChatsView to reset to the landing state.
  const newChat = () => {
    setChatToOpen(null)
    setTimeout(() => setChatToOpen('__new__'), 0)
    setView('chats')
  }

  // Global keyboard shortcuts: Ctrl/Cmd+K command palette, Ctrl/Cmd+N new chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      } else if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        newChat()
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (e.key === 'Escape') {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <Tooltips />
      <UpdateBanner />
      {navHidden &&
        (railOn ? (
          // Section icon rail (beta): a slim vertical bar of every section so you
          // can switch views without first restoring the full sidebar. Settings
          // sits at the bottom, matching its position in the full sidebar.
          <div className="nav-float nav-rail">
            <button className="nav-rail-btn nav-rail-toggle" onClick={toggleNav} title="Show sidebar">
              <PanelLeftIcon />
            </button>
            <div className="nav-rail-items">
              {NAV.map((item) => {
                const Icon = item.icon
                // Settings is the last section, but opens as a popup (never
                // replaces the current view) — matching the full sidebar.
                const isSettings = item.id === 'settings'
                const active = isSettings ? settingsOpen : view === item.id
                return (
                  <button
                    key={item.id}
                    className={`nav-rail-btn ${active ? 'active' : ''}`}
                    onClick={() => (isSettings ? setSettingsOpen(true) : setView(item.id))}
                    title={isSettings ? 'Settings (Ctrl+,)' : item.label}
                  >
                    <Icon />
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="nav-float">
            <button className="nav-show" onClick={toggleNav} title="Show sidebar">
              <PanelLeftIcon />
            </button>
            <button
              className="nav-show nav-show-gear"
              onClick={() => setSettingsOpen(true)}
              title="Settings (Ctrl+,)"
            >
              <SettingsIcon />
            </button>
          </div>
        ))}
      <aside className={`sidebar ${navHidden ? 'hidden' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-logo">
            <OrbitMark />
            <span className="brand-word">Orbit</span>
          </div>
          <button className="nav-hide" onClick={toggleNav} title="Hide sidebar">
            <PanelLeftIcon />
          </button>
        </div>
        <button
          className="sidebar-search"
          onClick={() => setPaletteOpen(true)}
          title="Search chats and jump anywhere (Ctrl+K)"
        >
          <SearchIcon />
          <span>Search…</span>
          <kbd>Ctrl K</kbd>
        </button>
        <nav className="sidebar-nav">
          {NAV.map((item) => {
            const Icon = item.icon
            const isActive = item.id === 'settings' ? settingsOpen : view === item.id
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? 'active' : ''}`}
                onClick={() => (item.id === 'settings' ? setSettingsOpen(true) : setView(item.id))}
              >
                <span className="nav-icon">
                  <Icon />
                </span>
                {item.label}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-footer">
          <span className="footer-version">
            v{version}
            {version.includes('beta') && <span className="beta-badge" title="This is a beta release">beta</span>}
          </span>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>
      </aside>
      <main className={`content ${navHidden ? 'nav-hidden' : ''} ${navHidden && railOn ? 'nav-railed' : ''}`}>
        {view === 'providers' ? (
          <ProvidersView />
        ) : view === 'chats' ? (
          <ChatsView initialId={chatToOpen} collapsed={navHidden} />
        ) : view === 'projects' ? (
          <ProjectsView onOpenConversation={openConversation} />
        ) : view === 'compare' ? (
          <CompareView />
        ) : view === 'swarm' ? (
          <SwarmView collapsed={navHidden} />
        ) : view === 'studio' ? (
          <StudioView collapsed={navHidden} />
        ) : view === 'forge' ? (
          <ForgeView collapsed={navHidden} />
        ) : (
          <CoworkView collapsed={navHidden} />
        )}
      </main>
      {settingsOpen && (
        <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
          <div
            className="modal settings-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setSettingsOpen(false)} title="Close (Esc)">
              ✕
            </button>
            <div className="modal-body">
              <SettingsView />
            </div>
          </div>
        </div>
      )}
      {paletteOpen && (
        <CommandPalette
          onClose={() => setPaletteOpen(false)}
          onNavigate={(v) => {
            if (v === 'settings') {
              setSettingsOpen(true)
            } else {
              setView(v)
            }
            setPaletteOpen(false)
          }}
          onNewChat={() => {
            setPaletteOpen(false)
            newChat()
          }}
          onOpenChat={(id) => {
            setPaletteOpen(false)
            openConversation(id)
          }}
          onToggleTheme={() => {
            toggleTheme()
            setPaletteOpen(false)
          }}
        />
      )}
    </div>
  )
}
