import { app } from 'electron'
import type { WebContents } from 'electron'
import { join, relative } from 'path'
import { getMathFormat } from './settings'
import { reasoningProviderOptions } from './reasoning'
import { mathInstruction } from '../shared/mathPrompt'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { exec } from 'child_process'
import { dynamicTool, jsonSchema, stepCountIs, streamText, type ModelMessage, type ToolSet } from 'ai'
import type {
  CoworkApprovalMode,
  CoworkEvent,
  CoworkEventPayload,
  CoworkLiveEvent,
  CoworkSession,
  CoworkSessionMeta,
  CoworkToolRequestEvent
} from '../shared/types'
import { resolveInWorkspace } from '../shared/sandbox'
import { diffLines, diffSummary, type DiffLine } from '../shared/diff'
import { getModel } from './providers'

// Forge is the developer-grade sibling of Cowork: same proven agent loop + tool
// set + sandbox, but its OWN storage dir and a Claude-Code-style system prompt +
// terminal UI. Kept as a parallel module (like swarm) so the two never mix.

interface PendingDiff {
  diff: DiffLine[] | null
  diffSummary: string
}

// ---------- session storage ----------

function dir(): string {
  const d = join(app.getPath('userData'), 'forge')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function pathFor(id: string): string {
  return join(dir(), `${id}.json`)
}

function save(s: CoworkSession): CoworkSession {
  s.updatedAt = Date.now()
  writeFileSync(pathFor(s.id), JSON.stringify(s, null, 2), 'utf-8')
  return s
}

export function listSessions(): CoworkSessionMeta[] {
  const metas: CoworkSessionMeta[] = []
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json')) continue
    try {
      const s = JSON.parse(readFileSync(join(dir(), file), 'utf-8')) as CoworkSession
      metas.push({
        id: s.id,
        title: s.title,
        workspace: s.workspace,
        providerId: s.providerId,
        modelId: s.modelId,
        mode: s.mode,
        updatedAt: s.updatedAt
      })
    } catch {
      // skip corrupt files
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): CoworkSession {
  return JSON.parse(readFileSync(pathFor(id), 'utf-8')) as CoworkSession
}

export function createSession(providerId: string, modelId: string): CoworkSession {
  const now = Date.now()
  const s: CoworkSession = {
    id: `f${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: 'New session',
    workspace: null,
    providerId,
    modelId,
    // Developers want momentum: file edits run freely, shell commands still ask.
    mode: 'auto-edits',
    createdAt: now,
    updatedAt: now,
    events: [],
    history: []
  }
  return save(s)
}

export function deleteSession(id: string): void {
  stopForge(id)
  rmSync(pathFor(id), { force: true })
}

export function updateSession(
  id: string,
  patch: Partial<Pick<CoworkSession, 'providerId' | 'modelId' | 'mode' | 'workspace' | 'effort'>>
): CoworkSession {
  return save({ ...getSession(id), ...patch })
}

// ---------- approval plumbing (same fail-closed pattern as cowork.ts) ----------

const pendingApprovals = new Map<string, (allowed: boolean) => void>()
const sessionAllowed = new Set<string>()

export function respondForgeTool(requestId: string, decision: 'allow' | 'always' | 'deny'): void {
  const resolve = pendingApprovals.get(requestId)
  if (!resolve) return
  pendingApprovals.delete(requestId)
  resolve(decision !== 'deny')
  if (decision === 'always') {
    const [, key] = requestId.split('|', 2)
    if (key) sessionAllowed.add(key)
  }
}

function requestApproval(
  sender: WebContents,
  sessionId: string,
  toolName: string,
  args: unknown,
  pendingDiff?: PendingDiff
): Promise<boolean> {
  const key = `${sessionId}:${toolName}`
  if (sessionAllowed.has(key)) return Promise.resolve(true)
  const requestId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}|${key}`
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(requestId, resolve)
    const event: CoworkToolRequestEvent = {
      requestId,
      sessionId,
      toolName,
      args,
      diff: pendingDiff?.diff,
      diffSummary: pendingDiff?.diffSummary
    }
    if (!sender.isDestroyed()) sender.send('forge:tool-request', event)
    setTimeout(() => {
      if (pendingApprovals.has(requestId)) {
        pendingApprovals.delete(requestId)
        resolve(false)
      }
    }, 10 * 60 * 1000)
  })
}

function needsApproval(toolName: string, mode: CoworkApprovalMode): boolean {
  if (toolName === 'list_files' || toolName === 'read_file') return false
  if (mode === 'auto-all') return false
  if (mode === 'auto-edits') return toolName === 'run_command'
  return true
}

// ---------- workspace tools ----------

const SKIP_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.venv', '__pycache__'])
const MAX_LIST_ENTRIES = 500
const MAX_READ_CHARS = 100_000
const MAX_OUTPUT_CHARS = 20_000

function walk(root: string, current: string, lines: string[]): void {
  if (lines.length >= MAX_LIST_ENTRIES) return
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (lines.length >= MAX_LIST_ENTRIES) {
      lines.push(`… (truncated at ${MAX_LIST_ENTRIES} entries)`)
      return
    }
    const full = join(current, entry.name)
    const rel = relative(root, full).replaceAll('\\', '/')
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        lines.push(`${rel}/ (skipped)`)
        continue
      }
      lines.push(`${rel}/`)
      walk(root, full, lines)
    } else {
      let size = 0
      try {
        size = statSync(full).size
      } catch {
        // unreadable entry — list it anyway
      }
      lines.push(`${rel} (${size.toLocaleString()} bytes)`)
    }
  }
}

function runCommand(command: string, cwd: string): Promise<string> {
  return new Promise((resolve) => {
    exec(
      command,
      { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const out = [stdout, stderr].filter(Boolean).join('\n--- stderr ---\n').trim()
        const capped =
          out.length > MAX_OUTPUT_CHARS ? `${out.slice(0, MAX_OUTPUT_CHARS)}\n… (output truncated)` : out
        if (err) {
          const reason = err.killed ? 'timed out after 120s' : `exited with code ${err.code ?? 'unknown'}`
          resolve(`Command ${reason}.\n${capped || '(no output)'}`)
        } else {
          resolve(capped || '(command finished with no output)')
        }
      }
    )
  })
}

function buildForgeTools(
  sender: WebContents,
  session: CoworkSession,
  diffs: Map<string, PendingDiff>
): ToolSet {
  const root = session.workspace!
  const tools: ToolSet = {}

  const guarded = (
    toolName: string,
    execute: (args: Record<string, unknown>) => Promise<string> | string,
    prepare?: (args: Record<string, unknown>) => PendingDiff
  ) => {
    return async (args: unknown, options?: { toolCallId?: string }): Promise<string> => {
      let pendingDiff: PendingDiff | undefined
      if (prepare) {
        try {
          pendingDiff = prepare(args as Record<string, unknown>)
          if (options?.toolCallId) diffs.set(options.toolCallId, pendingDiff)
        } catch {
          // bad path etc. — execute below will surface the real error
        }
      }
      if (needsApproval(toolName, getSession(session.id).mode)) {
        const allowed = await requestApproval(sender, session.id, toolName, args, pendingDiff)
        if (!allowed) return 'The user declined this action. Adapt or ask them what to do instead.'
      }
      try {
        return await execute(args as Record<string, unknown>)
      } catch (err) {
        return `${toolName} failed: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  tools['list_files'] = dynamicTool({
    description:
      'List files and folders in the project (recursive, sizes included). Optionally pass a subfolder path.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        dir: {
          type: 'string',
          description: 'Subfolder to list, relative to the project root. Omit for the whole project.'
        }
      }
    }),
    execute: guarded('list_files', (a) => {
      const target = resolveInWorkspace(root, typeof a.dir === 'string' ? a.dir : '.')
      const lines: string[] = []
      walk(root, target, lines)
      return lines.length > 0 ? lines.join('\n') : '(empty folder)'
    })
  })

  tools['read_file'] = dynamicTool({
    description: 'Read a source or text file from the project.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root' }
      },
      required: ['path']
    }),
    execute: guarded('read_file', (a) => {
      const target = resolveInWorkspace(root, String(a.path))
      const text = readFileSync(target, 'utf-8')
      return text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n… (file truncated)` : text
    })
  })

  tools['write_file'] = dynamicTool({
    description:
      'Create or overwrite a file in the project. Parent folders are created automatically. Always write the COMPLETE file content.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path relative to the project root' },
        content: { type: 'string', description: 'The full file content to write' }
      },
      required: ['path', 'content']
    }),
    execute: guarded(
      'write_file',
      (a) => {
        const target = resolveInWorkspace(root, String(a.path))
        mkdirSync(join(target, '..'), { recursive: true })
        const content = String(a.content)
        writeFileSync(target, content, 'utf-8')
        return `Wrote ${Buffer.byteLength(content, 'utf-8').toLocaleString()} bytes to ${a.path}`
      },
      (a) => {
        const target = resolveInWorkspace(root, String(a.path))
        const oldText = existsSync(target) ? readFileSync(target, 'utf-8') : ''
        const diff = diffLines(oldText, String(a.content))
        return { diff, diffSummary: diff ? diffSummary(diff) : 'file too large to preview' }
      }
    )
  })

  tools['delete_file'] = dynamicTool({
    description: 'Delete a file or folder (recursively) from the project.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the project root' }
      },
      required: ['path']
    }),
    execute: guarded('delete_file', (a) => {
      const target = resolveInWorkspace(root, String(a.path))
      if (!existsSync(target)) return `Nothing exists at ${a.path}`
      rmSync(target, { recursive: true, force: true })
      return `Deleted ${a.path}`
    })
  })

  tools['run_command'] = dynamicTool({
    description:
      'Run a shell command in the project folder (Windows cmd, 120s limit). Use for git, builds, installs, running the test suite, linters, type-checks, etc.',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to execute' }
      },
      required: ['command']
    }),
    execute: guarded('run_command', (a) => runCommand(String(a.command), root))
  })

  return tools
}

// ---------- agent loop ----------

const active = new Map<string, AbortController>()

export function stopForge(sessionId: string): void {
  active.get(sessionId)?.abort()
}

function systemPrompt(workspace: string): string {
  return [
    `You are Orbit Code, an expert software engineer working directly inside the user's project folder: ${workspace}`,
    'You operate like a coding agent in a developer terminal. You have tools: list_files, read_file, write_file, delete_file, run_command.',
    'How you work:',
    '- Orient first: list_files and read the relevant source before changing anything. Understand the existing code, conventions and structure.',
    '- Use run_command for real developer tasks: `git status`/`git diff`/`git log` to inspect version control, running the test suite, builds, linters, type-checkers, and installing dependencies.',
    '- When a command fails, READ the compiler/terminal error carefully and fix the actual root cause, then re-run to confirm it passes. Iterate until green.',
    '- write_file overwrites the WHOLE file — always include the complete new content, never a fragment or a diff. Match the surrounding code style.',
    '- Make focused, minimal changes that accomplish the task. Do not reformat unrelated code.',
    '- All paths are relative to the project root; you cannot touch anything outside it.',
    '- File edits may run automatically, but shell commands can require the user to approve them; if one is declined, adapt or ask what to do instead.',
    '- NEVER run destructive commands (force-push, hard resets that lose work, deleting the repo, etc.) without the user explicitly asking.',
    '- Work step by step until the task is fully done and verified, then give a concise engineer-to-engineer summary of what changed and why.',
    mathInstruction(getMathFormat())
  ].join('\n')
}

export async function sendForge(sender: WebContents, sessionId: string, text: string): Promise<void> {
  if (active.has(sessionId)) return

  const emit = (ev: CoworkLiveEvent) => {
    if (!sender.isDestroyed()) sender.send('forge:event', { sessionId, ev } satisfies CoworkEventPayload)
  }

  const session = getSession(sessionId)
  if (!session.workspace || !existsSync(session.workspace)) {
    emit({ type: 'error', message: 'Open a project folder first.' })
    return
  }

  const controller = new AbortController()
  active.set(sessionId, controller)

  const mutate = (fn: (s: CoworkSession) => void) => {
    const s = getSession(sessionId)
    fn(s)
    save(s)
  }
  const pushEvent = (ev: CoworkEvent) => mutate((s) => s.events.push(ev))

  pushEvent({ type: 'user', text, at: Date.now() })
  if (session.title === 'New session') {
    mutate((s) => {
      s.title = text.length > 42 ? `${text.slice(0, 42)}…` : text
    })
  }

  const history = session.history as ModelMessage[]
  const messages: ModelMessage[] = [...history, { role: 'user', content: text }]

  let textBuf = ''
  let fullText = ''
  const flushText = () => {
    if (textBuf.trim().length > 0) pushEvent({ type: 'text', text: textBuf, at: Date.now() })
    textBuf = ''
  }

  try {
    const model = getModel(session.providerId, session.modelId)
    const diffs = new Map<string, PendingDiff>()
    const tools = buildForgeTools(sender, session, diffs)

    const providerOptions = reasoningProviderOptions(
      session.providerId,
      session.modelId,
      session.effort
    )
    const result = streamText({
      model,
      system: systemPrompt(session.workspace),
      messages,
      tools,
      abortSignal: controller.signal,
      stopWhen: stepCountIs(40),
      ...(providerOptions ? { providerOptions } : {})
    })

    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') {
        textBuf += part.text
        fullText += part.text
        emit({ type: 'text-delta', delta: part.text })
      } else if (part.type === 'reasoning-delta') {
        emit({ type: 'reasoning-delta', delta: part.text })
      } else if (part.type === 'finish-step') {
        const u = part.usage
        const stepTokens = u?.totalTokens ?? (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0)
        if (stepTokens > 0) emit({ type: 'usage', stepTokens })
      } else if (part.type === 'tool-call') {
        flushText()
        pushEvent({ type: 'tool-call', toolName: part.toolName, args: part.input, at: Date.now() })
        emit({ type: 'tool-call', toolName: part.toolName, args: part.input })
      } else if (part.type === 'tool-result') {
        const resultText = typeof part.output === 'string' ? part.output : JSON.stringify(part.output)
        const diff = diffs.get(part.toolCallId)?.diff ?? undefined
        diffs.delete(part.toolCallId)
        pushEvent({ type: 'tool-result', toolName: part.toolName, result: resultText, diff, at: Date.now() })
        emit({ type: 'tool-result', toolName: part.toolName, result: resultText, diff })
      } else if (part.type === 'tool-error') {
        const msg = part.error instanceof Error ? part.error.message : String(part.error)
        pushEvent({ type: 'tool-result', toolName: part.toolName, result: msg, error: true, at: Date.now() })
        emit({ type: 'tool-result', toolName: part.toolName, result: msg, error: true })
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    }

    flushText()
    const responseMessages = await result.responseMessages
    mutate((s) => {
      s.history = [...messages, ...responseMessages]
    })
    emit({ type: 'done' })
  } catch (err) {
    if (controller.signal.aborted) {
      flushText()
      pushEvent({ type: 'status', text: 'Stopped by user', at: Date.now() })
      mutate((s) => {
        s.history = [
          ...messages,
          { role: 'assistant', content: fullText || '(stopped by the user before responding)' }
        ]
      })
      emit({ type: 'done' })
    } else {
      const message = err instanceof Error ? err.message : String(err)
      pushEvent({ type: 'error', text: message, at: Date.now() })
      emit({ type: 'error', message })
    }
  } finally {
    active.delete(sessionId)
  }
}
