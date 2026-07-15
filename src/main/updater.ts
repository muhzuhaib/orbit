// Auto-update via electron-updater (GitHub Releases provider — see the `publish`
// block in electron-builder.yml). Only runs in the packaged app. Downloads new
// versions in the background and, when one is ready, tells the renderer so it can
// offer a "Restart to update" banner. All errors are swallowed (a missing release
// / offline / 404 before the first publish must never disrupt the app).
import { app, ipcMain, type BrowserWindow } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '../shared/types'

const { autoUpdater } = electronUpdater

export function initAutoUpdater(getWindow: () => BrowserWindow | null): void {
  // In dev there is no update feed and electron-updater throws — skip entirely.
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  const send = (payload: UpdateStatus): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send('update:status', payload)
  }

  autoUpdater.on('checking-for-update', () => send({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ status: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ status: 'none' }))
  autoUpdater.on('download-progress', (p) => send({ status: 'downloading', percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => send({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (err) => {
    // Expected before the first GitHub release exists (404) or when offline.
    console.warn('[updater]', err instanceof Error ? err.message : String(err))
    send({ status: 'idle' })
  })

  // Let the renderer trigger the install-on-restart.
  ipcMain.handle('update:restart', () => {
    autoUpdater.quitAndInstall()
  })

  const check = (): void => {
    autoUpdater
      .checkForUpdates()
      .catch((e) => console.warn('[updater] check failed:', e instanceof Error ? e.message : e))
  }
  // Check a few seconds after launch (let the UI settle), then every 6 hours.
  setTimeout(check, 8_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}
