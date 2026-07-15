import { app, BrowserWindow } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { streamText } from 'ai'
import { reasoningProviderOptions } from './reasoning'
import type { StudioEventPayload, StudioLiveEvent, StudioSession, StudioSessionMeta } from '../shared/types'
import { getModel } from './providers'
import { setArtifact } from './artifacts'

// ---------- session storage (mirrors conversations.ts / cowork.ts) ----------

function dir(): string {
  const d = join(app.getPath('userData'), 'studio')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function pathFor(id: string): string {
  return join(dir(), `${id}.json`)
}

function save(s: StudioSession): StudioSession {
  s.updatedAt = Date.now()
  writeFileSync(pathFor(s.id), JSON.stringify(s, null, 2), 'utf-8')
  return s
}

export function listSessions(): StudioSessionMeta[] {
  const metas: StudioSessionMeta[] = []
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json')) continue
    try {
      const s = JSON.parse(readFileSync(join(dir(), file), 'utf-8')) as StudioSession
      metas.push({
        id: s.id,
        title: s.title,
        providerId: s.providerId,
        modelId: s.modelId,
        updatedAt: s.updatedAt
      })
    } catch {
      // skip corrupt files
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): StudioSession {
  return JSON.parse(readFileSync(pathFor(id), 'utf-8')) as StudioSession
}

export function createSession(providerId: string, modelId: string): StudioSession {
  const now = Date.now()
  const s: StudioSession = {
    id: `d${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: 'New design',
    providerId,
    modelId,
    createdAt: now,
    updatedAt: now,
    turns: []
  }
  return save(s)
}

export function deleteSession(id: string): void {
  stopStudio(id)
  rmSync(pathFor(id), { force: true })
}

export function updateSession(
  id: string,
  patch: Partial<Pick<StudioSession, 'providerId' | 'modelId' | 'title' | 'effort'>>
): StudioSession {
  return save({ ...getSession(id), ...patch })
}

// ---------- HTML extraction ----------

/**
 * Pull the HTML document out of the model's reply. Models usually wrap it in a
 * ```html fenced block; sometimes they return raw HTML. We take the fenced block
 * if present, else the text from the first <!doctype/<html to the end.
 */
export function extractHtml(text: string): string {
  const fence = text.match(/```(?:html)?\s*\n([\s\S]*?)```/i)
  if (fence && /<(?:!doctype|html|body|div|main|section|style)/i.test(fence[1])) {
    return fence[1].trim()
  }
  const start = text.search(/<!doctype html|<html[\s>]/i)
  if (start !== -1) return text.slice(start).trim()
  // No obvious document — wrap whatever we got so the preview still shows something.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${text}</body></html>`
}

/**
 * Inject a thin, unobtrusive scrollbar style at the TOP of the document's head
 * so the live preview doesn't show a chunky OS scrollbar (especially in the
 * narrow mobile/tablet frames). Injected only for previews — the saved/copied
 * HTML the user gets stays exactly as the model wrote it. Placed first so any
 * scrollbar styling in the design itself still wins.
 */
const PREVIEW_SCROLLBAR_CSS = `<style>*::-webkit-scrollbar{width:9px;height:9px}*::-webkit-scrollbar-track{background:transparent}*::-webkit-scrollbar-thumb{background:rgba(140,140,150,.5);border-radius:8px;border:2px solid transparent;background-clip:padding-box}html{scrollbar-width:thin;scrollbar-color:rgba(140,140,150,.5) transparent}</style>`

function withPreviewChrome(html: string): string {
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch) {
    const at = headMatch.index! + headMatch[0].length
    return html.slice(0, at) + PREVIEW_SCROLLBAR_CSS + html.slice(at)
  }
  const htmlMatch = html.match(/<html[^>]*>/i)
  if (htmlMatch) {
    const at = htmlMatch.index! + htmlMatch[0].length
    return html.slice(0, at) + PREVIEW_SCROLLBAR_CSS + html.slice(at)
  }
  return PREVIEW_SCROLLBAR_CSS + html
}

function previewArtifact(html: string): string {
  return setArtifact(withPreviewChrome(html))
}

// ---------- generation ----------

const active = new Map<string, AbortController>()

export function stopStudio(sessionId: string): void {
  active.get(sessionId)?.abort()
}

function systemPrompt(): string {
  return [
    'You are Orbit Studio, an expert web designer and front-end engineer.',
    'The user describes a website, web app, landing page, component or UI in plain language.',
    'You reply with ONE complete, self-contained HTML document that renders their design.',
    'Hard rules:',
    '- Output ONLY the HTML document, inside a single ```html code block. No explanations before or after.',
    '- The document must be fully self-contained: put ALL CSS in a <style> tag and ALL JavaScript in a <script> tag inside the file.',
    '- Do NOT link to any external files, CDNs, stylesheets, fonts or scripts — everything runs offline with no network. Use system fonts and inline SVG for icons/graphics.',
    '- Make it look modern, polished and responsive. Thoughtful spacing, colour and typography. Include realistic placeholder content.',
    '- Any interactivity (tabs, menus, forms, counters, etc.) must actually work via the inline script.',
    'When the user asks for a change, return the FULL updated document again (never a fragment or a diff), keeping everything else intact.'
  ].join('\n')
}

/** Run one design turn: prompt (+ previous HTML) → streamed HTML → live preview. */
export async function runStudio(sender: WebContents, sessionId: string, prompt: string): Promise<void> {
  if (active.has(sessionId)) return

  const emit = (ev: StudioLiveEvent) => {
    if (!sender.isDestroyed()) sender.send('studio:event', { sessionId, ev } satisfies StudioEventPayload)
  }

  const session = getSession(sessionId)
  const controller = new AbortController()
  active.set(sessionId, controller)

  if (session.title === 'New design') {
    session.title = prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt
    save(session)
  }

  const previous = session.turns.length > 0 ? session.turns[session.turns.length - 1].html : ''
  const userMessage = previous
    ? `Here is the current design (the full HTML document):\n\n\`\`\`html\n${previous}\n\`\`\`\n\nUpdate it as follows, returning the complete updated document:\n${prompt}`
    : prompt

  try {
    emit({ type: 'status', text: 'Designing…' })
    const model = getModel(session.providerId, session.modelId)
    const providerOptions = reasoningProviderOptions(
      session.providerId,
      session.modelId,
      session.effort
    )
    const result = streamText({
      model,
      system: systemPrompt(),
      messages: [{ role: 'user', content: userMessage }],
      abortSignal: controller.signal,
      ...(providerOptions ? { providerOptions } : {})
    })

    let full = ''
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        full += part.text
        emit({ type: 'code-delta', delta: part.text })
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    }

    const html = extractHtml(full)
    const url = previewArtifact(html)
    const s = getSession(sessionId)
    s.turns.push({ prompt, html, at: Date.now() })
    save(s)
    emit({ type: 'preview', url, html })
    emit({ type: 'done' })
  } catch (err) {
    if (controller.signal.aborted) {
      emit({ type: 'status', text: 'Stopped by user' })
      emit({ type: 'done' })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      emit({ type: 'error', message })
    }
  } finally {
    active.delete(sessionId)
  }
}

/** Re-register a saved turn's HTML with the artifact protocol → returns its url. */
export function previewUrlFor(html: string): string {
  return previewArtifact(html)
}

/** Open the design full-size in its own window (native scrolling, real dimensions). */
export function openWindow(html: string): void {
  const url = previewArtifact(html)
  const w = new BrowserWindow({
    width: 1200,
    height: 860,
    title: 'Design preview',
    backgroundColor: '#ffffff',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  w.setMenuBarVisibility(false)
  w.loadURL(url)
}
