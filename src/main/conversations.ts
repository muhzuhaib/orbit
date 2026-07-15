import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import type {
  ChatMessage,
  Conversation,
  ConversationMeta,
  ConversationSearchHit
} from '../shared/types'

function dir(): string {
  const d = join(app.getPath('userData'), 'conversations')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function pathFor(id: string): string {
  return join(dir(), `${id}.json`)
}

function save(conv: Conversation): Conversation {
  conv.updatedAt = Date.now()
  writeFileSync(pathFor(conv.id), JSON.stringify(conv, null, 2), 'utf-8')
  return conv
}

export function listConversations(): ConversationMeta[] {
  const metas: ConversationMeta[] = []
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json')) continue
    try {
      const c = JSON.parse(readFileSync(join(dir(), file), 'utf-8')) as Conversation
      metas.push({
        id: c.id,
        title: c.title,
        providerId: c.providerId,
        modelId: c.modelId,
        updatedAt: c.updatedAt,
        projectId: c.projectId,
        pinned: c.pinned,
        folderId: c.folderId
      })
    } catch {
      // skip corrupt files rather than breaking the whole list
    }
  }
  // Pinned chats first, then most-recently-updated.
  return metas.sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt - a.updatedAt)
}

export function getConversation(id: string): Conversation {
  return JSON.parse(readFileSync(pathFor(id), 'utf-8')) as Conversation
}

/**
 * Search every conversation by title and message text. Returns hits (newest
 * first) with a short excerpt around the first message match.
 */
export function searchConversations(query: string): ConversationSearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: ConversationSearchHit[] = []
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json')) continue
    try {
      const c = JSON.parse(readFileSync(join(dir(), file), 'utf-8')) as Conversation
      const titleMatch = c.title.toLowerCase().includes(q)
      let snippet = ''
      let inBody = false
      for (const m of c.messages) {
        const idx = m.content.toLowerCase().indexOf(q)
        if (idx !== -1) {
          inBody = true
          const start = Math.max(0, idx - 40)
          snippet =
            (start > 0 ? '…' : '') +
            m.content.slice(start, idx + q.length + 60).replace(/\s+/g, ' ').trim() +
            '…'
          break
        }
      }
      if (titleMatch || inBody) {
        hits.push({
          id: c.id,
          title: c.title,
          updatedAt: c.updatedAt,
          projectId: c.projectId,
          snippet,
          inBody
        })
      }
    } catch {
      // skip corrupt files
    }
  }
  return hits.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function createConversation(
  providerId: string,
  modelId: string,
  projectId?: string
): Conversation {
  const now = Date.now()
  const conv: Conversation = {
    id: `c${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: 'New chat',
    providerId,
    modelId,
    systemPrompt: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
    projectId
  }
  return save(conv)
}

export function deleteConversation(id: string): void {
  rmSync(pathFor(id), { force: true })
}

/** Delete several conversations at once (multi-select). */
export function deleteConversations(ids: string[]): void {
  for (const id of ids) rmSync(pathFor(id), { force: true })
}

/** Delete every conversation. Returns how many were removed. */
export function deleteAllConversations(): number {
  let count = 0
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json')) continue
    rmSync(join(dir(), file), { force: true })
    count++
  }
  return count
}

export function updateConversation(
  id: string,
  patch: Partial<
    Pick<
      Conversation,
      | 'title'
      | 'providerId'
      | 'modelId'
      | 'systemPrompt'
      | 'thinking'
      | 'effort'
      | 'webSearch'
      | 'autopilot'
      | 'pinned'
      | 'folderId'
    >
  >
): Conversation {
  return save({ ...getConversation(id), ...patch })
}

export function appendMessage(id: string, message: ChatMessage): Conversation {
  const conv = getConversation(id)
  conv.messages.push(message)
  // First user message names the chat
  if (conv.title === 'New chat' && message.role === 'user') {
    conv.title = message.content.length > 42 ? `${message.content.slice(0, 42)}…` : message.content
  }
  return save(conv)
}

export function replaceMessages(id: string, messages: ChatMessage[]): Conversation {
  const conv = getConversation(id)
  conv.messages = messages
  return save(conv)
}
