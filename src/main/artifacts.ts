import { protocol } from 'electron'

/**
 * Serves artifact previews (HTML/SVG the model generated) on a dedicated
 * `artifact://` origin. A real scheme (unlike srcdoc/data:) does NOT inherit
 * the renderer's strict CSP, so scripts inside the preview can run — while the
 * iframe's sandbox="allow-scripts" keeps it fully isolated from the app
 * (no window.api, no storage, no same-origin access).
 */

const artifacts = new Map<string, string>()
const MAX_ARTIFACTS = 20

export function setArtifact(html: string): string {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  artifacts.set(id, html)
  // keep memory bounded — previews are transient
  while (artifacts.size > MAX_ARTIFACTS) {
    const oldest = artifacts.keys().next().value
    if (oldest === undefined) break
    artifacts.delete(oldest)
  }
  return `artifact://a/${id}`
}

export function registerArtifactProtocol(): void {
  protocol.handle('artifact', (request) => {
    const id = new URL(request.url).pathname.replace(/^\//, '')
    const html = artifacts.get(id)
    if (html === undefined) {
      return new Response('Artifact expired. Re-open the preview from the chat message.', {
        status: 404,
        headers: { 'content-type': 'text/plain' }
      })
    }
    return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  })
}
