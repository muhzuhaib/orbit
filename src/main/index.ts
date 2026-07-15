import { app, shell, BrowserWindow, protocol } from 'electron'
import { join } from 'path'
import { registerIpc } from './ipc'
import { syncMcp } from './mcp'
import { listModels } from './registry'
import { migrateOllamaCloud, migrateGroq } from './migrate'
import { registerArtifactProtocol } from './artifacts'
import { initAutoUpdater } from './updater'

// must run before app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'artifact', privileges: { standard: true, secure: true } }
])

// The primary window, tracked so the auto-updater can push status to the renderer.
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1b1d',
    title: 'Orbit',
    // Frameless with a themed overlay so the top strip matches the app body
    // instead of the mismatched native OS title bar. The window controls
    // (min/max/close) are drawn by the OS into the overlay; the rest of the top
    // strip is app content with a CSS drag region. Colours are updated on theme
    // change via the 'window:titlebar' IPC. (dark theme values by default.)
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#1b1b1d',
      symbolColor: '#9a9aa2',
      height: 40
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.on('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  // Allow microphone access for voice dictation (Electron denies permission
  // requests by default). Only 'media' is granted; everything else stays denied.
  const ses = win.webContents.session
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(permission === 'media'))
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'media')

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  // must run before anything reads config/secrets/model cache
  migrateOllamaCloud()
  migrateGroq()
  registerArtifactProtocol()
  registerIpc()
  // connect configured MCP servers in the background
  syncMcp().catch(() => {})
  // warm the live model-list cache so the first model picker opens instantly
  listModels().catch(() => {})

  createWindow()

  // Background auto-update (packaged builds only; no-ops in dev).
  initAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
