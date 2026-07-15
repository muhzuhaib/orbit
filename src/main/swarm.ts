import { app } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { generateText, streamText, type ModelMessage } from 'ai'
import { getMathFormat } from './settings'
import { mathInstruction } from '../shared/mathPrompt'
import type {
  SwarmEventPayload,
  SwarmLiveEvent,
  SwarmSession,
  SwarmSessionMeta,
  SwarmSubtask,
  SwarmTurn
} from '../shared/types'
import { getModel } from './providers'

// Swarm = multi-agent orchestration. A "lead" (manager) model plans + delegates
// to worker models that run in PARALLEL, then the lead synthesises the results.
// Storage is a dedicated dir so Swarm and Cowork sessions never mix.

const MAX_SUBTASKS = 5

// ---------- session storage (mirrors cowork.ts, separate folder) ----------

function dir(): string {
  const d = join(app.getPath('userData'), 'swarm')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

function pathFor(id: string): string {
  return join(dir(), `${id}.json`)
}

function save(s: SwarmSession): SwarmSession {
  s.updatedAt = Date.now()
  writeFileSync(pathFor(s.id), JSON.stringify(s, null, 2), 'utf-8')
  return s
}

export function listSessions(): SwarmSessionMeta[] {
  const metas: SwarmSessionMeta[] = []
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json')) continue
    try {
      const s = JSON.parse(readFileSync(join(dir(), file), 'utf-8')) as SwarmSession
      metas.push({
        id: s.id,
        title: s.title,
        managerProviderId: s.managerProviderId,
        managerModelId: s.managerModelId,
        workerCount: s.workers.length,
        updatedAt: s.updatedAt
      })
    } catch {
      // skip corrupt files
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getSession(id: string): SwarmSession {
  return JSON.parse(readFileSync(pathFor(id), 'utf-8')) as SwarmSession
}

const wid = (): string => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function createSession(managerProviderId: string, managerModelId: string): SwarmSession {
  const now = Date.now()
  const s: SwarmSession = {
    id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    title: 'New team',
    managerProviderId,
    managerModelId,
    workerCount: 0,
    createdAt: now,
    updatedAt: now,
    // seed with the manager model as the first worker so a new session is usable immediately
    workers: [{ id: wid(), providerId: managerProviderId, modelId: managerModelId }],
    turns: []
  }
  return save(s)
}

export function deleteSession(id: string): void {
  stopSwarm(id)
  rmSync(pathFor(id), { force: true })
}

export function updateSession(
  id: string,
  patch: Partial<Pick<SwarmSession, 'managerProviderId' | 'managerModelId' | 'workers' | 'title'>>
): SwarmSession {
  const s = { ...getSession(id), ...patch }
  s.workerCount = s.workers.length
  return save(s)
}

// ---------- orchestration ----------

const active = new Map<string, AbortController[]>()

export function stopSwarm(sessionId: string): void {
  active.get(sessionId)?.forEach((c) => c.abort())
  active.delete(sessionId)
}

/** Strip ``` fences and pull the first {...} JSON object out of a model reply. */
function extractJson(text: string): unknown {
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

interface PlannedSubtask {
  worker: number
  title: string
  assignment: string
}

/** Ask the lead model to split the task and assign subtasks to workers. */
async function planSubtasks(
  session: SwarmSession,
  task: string,
  signal: AbortSignal
): Promise<PlannedSubtask[]> {
  const roster = session.workers
    .map((w, i) => `[${i}] ${w.providerId}/${w.modelId}`)
    .join('\n')

  const n = session.workers.length
  const prompt = [
    'You are the LEAD coordinator of a team of AI workers. Split the user task into',
    'independent subtasks that can be worked on IN PARALLEL, and assign each to the most',
    'suitable worker. Every subtask must be self-contained (a worker only sees its own',
    'assignment, not the others).',
    '',
    `You have ${n} worker${n === 1 ? '' : 's'} available (use the number in brackets):`,
    roster,
    '',
    'IMPORTANT for speed: whenever the task has separable parts (e.g. research + drafting,',
    'multiple sections, alternative approaches, or the same job done independently for',
    'cross-checking), split it into SEVERAL subtasks and assign them to DIFFERENT workers so',
    'they run at the same time. Only fall back to a single subtask when the task genuinely',
    `cannot be divided. Use up to ${Math.min(n, MAX_SUBTASKS)} subtasks.`,
    '',
    'Reply with ONLY a JSON object (no prose, no code fence):',
    '{"subtasks":[{"worker":<number>,"title":"<short title>","assignment":"<full instructions>"}]}',
    '',
    'TASK:',
    task
  ].join('\n')

  const { text } = await generateText({
    model: getModel(session.managerProviderId, session.managerModelId),
    prompt,
    abortSignal: signal
  })

  let parsed: PlannedSubtask[] = []
  try {
    const obj = extractJson(text) as { subtasks?: PlannedSubtask[] }
    if (Array.isArray(obj?.subtasks)) parsed = obj.subtasks
  } catch {
    // fall through to the single-subtask fallback below
  }

  // Sanitise + clamp; fall back to one subtask on the first worker.
  parsed = parsed
    .filter((p) => p && typeof p.assignment === 'string' && p.assignment.trim())
    .slice(0, MAX_SUBTASKS)
    .map((p) => ({
      worker: Number.isInteger(p.worker) && p.worker >= 0 && p.worker < n ? p.worker : 0,
      title: (p.title || 'Subtask').toString().slice(0, 80),
      assignment: p.assignment
    }))
  if (parsed.length === 0) {
    parsed = [{ worker: 0, title: 'Complete the task', assignment: task }]
  }
  return parsed
}

/** Run one swarm turn: plan → workers in parallel → lead synthesis. */
export async function runSwarm(sender: WebContents, sessionId: string, task: string): Promise<void> {
  if (active.has(sessionId)) return

  const emit = (ev: SwarmLiveEvent): void => {
    if (!sender.isDestroyed()) sender.send('swarm:event', { sessionId, ev } satisfies SwarmEventPayload)
  }

  const session = getSession(sessionId)
  if (session.workers.length === 0) {
    emit({ type: 'error', message: 'Add at least one worker model first.' })
    return
  }

  const controllers: AbortController[] = []
  active.set(sessionId, controllers)
  const newController = (): AbortController => {
    const c = new AbortController()
    controllers.push(c)
    return c
  }

  const turn: SwarmTurn = { task, subtasks: [], synthesis: '', at: Date.now() }

  try {
    // 1) Plan
    emit({ type: 'status', text: 'Lead is planning and delegating…' })
    const planned = await planSubtasks(session, task, newController().signal)

    const subtasks: SwarmSubtask[] = planned.map((p) => {
      const worker = session.workers[p.worker]
      return {
        id: `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        workerId: worker.id,
        model: `${worker.providerId}/${worker.modelId}`,
        title: p.title,
        assignment: p.assignment,
        output: '',
        status: 'running'
      }
    })
    turn.subtasks = subtasks
    emit({
      type: 'plan',
      subtasks: subtasks.map((s) => ({
        id: s.id,
        workerId: s.workerId,
        model: s.model,
        title: s.title,
        assignment: s.assignment
      }))
    })

    // 2) Workers in parallel
    await Promise.all(
      subtasks.map(async (st) => {
        const worker = session.workers.find((w) => w.id === st.workerId)!
        const controller = newController()
        try {
          const messages: ModelMessage[] = [
            {
              role: 'user',
              content: [
                'You are a specialist worker on a team. Complete ONLY your assigned part and',
                'return your result directly (no preamble).',
                '',
                `OVERALL GOAL: ${task}`,
                '',
                `YOUR ASSIGNMENT: ${st.assignment}`,
                '',
                mathInstruction(getMathFormat())
              ].join('\n')
            }
          ]
          const result = streamText({
            model: getModel(worker.providerId, worker.modelId),
            messages,
            abortSignal: controller.signal
          })
          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              st.output += part.text
              emit({ type: 'worker-chunk', subtaskId: st.id, delta: part.text })
            } else if (part.type === 'error') {
              throw part.error instanceof Error ? part.error : new Error(String(part.error))
            }
          }
          st.status = 'done'
          emit({ type: 'worker-done', subtaskId: st.id })
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          st.status = 'error'
          st.error = message
          emit({ type: 'worker-error', subtaskId: st.id, message })
        }
      })
    )

    // 3) Lead synthesis
    emit({ type: 'status', text: 'Lead is combining the results…' })
    const resultsBlock = subtasks
      .map(
        (s) =>
          `### ${s.title} (by ${s.model})\n${s.status === 'error' ? `[failed: ${s.error}]` : s.output || '(no output)'}`
      )
      .join('\n\n')
    const synthPrompt = [
      'You are the LEAD coordinator. Your workers have finished their subtasks. Combine their',
      'results into ONE coherent, complete final answer for the user. Resolve conflicts, remove',
      'duplication, and present it clearly. Do not mention the internal coordination unless useful.',
      '',
      `ORIGINAL TASK: ${task}`,
      '',
      'WORKER RESULTS:',
      resultsBlock,
      '',
      mathInstruction(getMathFormat())
    ].join('\n')

    const synth = streamText({
      model: getModel(session.managerProviderId, session.managerModelId),
      prompt: synthPrompt,
      abortSignal: newController().signal
    })
    for await (const part of synth.fullStream) {
      if (part.type === 'text-delta') {
        turn.synthesis += part.text
        emit({ type: 'synthesis-chunk', delta: part.text })
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    }

    // persist the completed turn
    const s = getSession(sessionId)
    s.turns.push(turn)
    if (s.title === 'New team' || s.title === 'New swarm') s.title = task.length > 42 ? `${task.slice(0, 42)}…` : task
    save(s)
    emit({ type: 'done' })
  } catch (err) {
    if (controllers.some((c) => c.signal.aborted)) {
      // Save whatever we have so the partial turn isn't lost.
      const s = getSession(sessionId)
      if (turn.subtasks.length > 0 || turn.synthesis) {
        s.turns.push(turn)
        save(s)
      }
      emit({ type: 'done' })
    } else {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  } finally {
    active.delete(sessionId)
  }
}
