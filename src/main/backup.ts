// Encrypted backup / restore / delete of ALL personal Orbit data (issue #9).
//
// Backup gathers every Orbit-owned file under userData — chats, projects,
// skills, folders, prompt templates, app settings and (decrypted) API keys —
// into a single JSON payload, then encrypts it with AES-256-GCM using a key the
// user derives from a password/PIN they choose at export time. Without that
// password the file is unreadable, so it is safe to move between computers.
//
// API keys are stored on disk machine-bound (Electron safeStorage / Windows
// DPAPI), so a portable backup must carry the DECRYPTED keys and re-encrypt them
// with safeStorage on restore — otherwise they would not decrypt on a new PC.

import { app, dialog, type BrowserWindow } from 'electron'
import { join, relative, dirname } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto'
import { exportSecrets, importSecrets } from './settings'

// Orbit-owned entries under userData. Everything else (Chromium caches, the
// models-cache, the raw machine-bound secrets.json) is deliberately excluded.
const DATA_FILES = ['config.json', 'memory.md', 'benchmarks.json']
const DATA_DIRS = ['conversations', 'projects', 'skills', 'cowork', 'swarm', 'studio', 'forge']

interface BackupPayload {
  app: 'orbit-backup'
  version: number
  createdAt: number
  /** relative-path → base64 file contents */
  files: Record<string, string>
  /** providerId → plaintext API key */
  secrets: Record<string, string>
}

interface Envelope {
  orbit: 'backup'
  v: number
  salt: string
  iv: string
  tag: string
  data: string
}

function userData(): string {
  return app.getPath('userData')
}

/** Recursively collect a file or directory into the base64 files map. */
function collect(absPath: string, root: string, out: Record<string, string>): void {
  if (!existsSync(absPath)) return
  const st = statSync(absPath)
  if (st.isDirectory()) {
    for (const name of readdirSync(absPath)) collect(join(absPath, name), root, out)
  } else {
    const rel = relative(root, absPath).split('\\').join('/')
    out[rel] = readFileSync(absPath).toString('base64')
  }
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, 32)
}

/** Ask where to save, gather + encrypt everything, write the .orbitbackup file. */
export async function exportBackup(
  win: BrowserWindow | null,
  password: string
): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (!password || password.length < 4) {
    return { ok: false, error: 'Please choose a password of at least 4 characters.' }
  }
  const root = userData()
  const files: Record<string, string> = {}
  for (const f of DATA_FILES) collect(join(root, f), root, files)
  for (const d of DATA_DIRS) collect(join(root, d), root, files)

  const payload: BackupPayload = {
    app: 'orbit-backup',
    version: 1,
    createdAt: Date.now(),
    files,
    secrets: exportSecrets()
  }

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = deriveKey(password, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf-8'), cipher.final()])
  const envelope: Envelope = {
    orbit: 'backup',
    v: 1,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: enc.toString('base64')
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const res = await dialog.showSaveDialog(win!, {
    title: 'Save encrypted Orbit backup',
    defaultPath: `orbit-backup-${stamp}.orbitbackup`,
    filters: [{ name: 'Orbit backup', extensions: ['orbitbackup'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false }
  writeFileSync(res.filePath, JSON.stringify(envelope), 'utf-8')
  return { ok: true, path: res.filePath }
}

/** Pick a .orbitbackup file, decrypt with the password, write everything back. */
export async function restoreBackup(
  win: BrowserWindow | null,
  password: string
): Promise<{ ok: boolean; error?: string }> {
  const res = await dialog.showOpenDialog(win!, {
    title: 'Restore Orbit backup',
    properties: ['openFile'],
    filters: [{ name: 'Orbit backup', extensions: ['orbitbackup'] }]
  })
  if (res.canceled || res.filePaths.length === 0) return { ok: false }

  let payload: BackupPayload
  try {
    const envelope = JSON.parse(readFileSync(res.filePaths[0], 'utf-8')) as Envelope
    if (envelope.orbit !== 'backup') return { ok: false, error: 'That file is not an Orbit backup.' }
    const salt = Buffer.from(envelope.salt, 'base64')
    const iv = Buffer.from(envelope.iv, 'base64')
    const tag = Buffer.from(envelope.tag, 'base64')
    const key = deriveKey(password, salt)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    const dec = Buffer.concat([
      decipher.update(Buffer.from(envelope.data, 'base64')),
      decipher.final()
    ])
    payload = JSON.parse(dec.toString('utf-8')) as BackupPayload
  } catch {
    // A wrong password fails the GCM auth check here.
    return { ok: false, error: 'Could not open the backup — wrong password or the file is corrupt.' }
  }
  if (payload.app !== 'orbit-backup') return { ok: false, error: 'Unrecognised backup format.' }

  const root = userData()
  // Clear existing Orbit data first so a restore is a clean replace.
  wipeData()
  for (const [rel, b64] of Object.entries(payload.files)) {
    const target = join(root, rel)
    // Stay within userData — ignore any path trying to escape it.
    if (!target.startsWith(root)) continue
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, Buffer.from(b64, 'base64'))
  }
  if (payload.secrets) importSecrets(payload.secrets)
  return { ok: true }
}

/** Remove every Orbit-owned data file/dir (chats, projects, skills, settings, keys). */
function wipeData(): void {
  const root = userData()
  for (const f of [...DATA_FILES, 'secrets.json', 'models-cache.json']) {
    rmSync(join(root, f), { force: true })
  }
  for (const d of DATA_DIRS) {
    rmSync(join(root, d), { recursive: true, force: true })
  }
}

/** Permanently delete all personal data. The renderer clears its own
 *  localStorage (theme/prefs/caches) and reloads afterwards. */
export function deleteAllData(): void {
  wipeData()
}
