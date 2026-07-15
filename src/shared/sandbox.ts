import { resolve, sep } from 'path'

/**
 * Resolve a model-supplied path against the workspace root and throw if the
 * result would land outside it (absolute paths, `..` tricks, drive changes).
 * Electron-free so plain Node can unit-test it.
 */
export function resolveInWorkspace(root: string, relPath: string): string {
  const rootAbs = resolve(root)
  const target = resolve(rootAbs, relPath)
  // Windows paths are case-insensitive
  const norm = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const t = norm(target)
  const r = norm(rootAbs)
  if (t !== r && !t.startsWith(r.endsWith(sep) ? r : r + sep)) {
    throw new Error(`Path escapes the workspace: ${relPath}`)
  }
  return target
}
