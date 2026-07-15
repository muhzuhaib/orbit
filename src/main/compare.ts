import { streamText, type ModelMessage } from 'ai'
import type { WebContents } from 'electron'
import type {
  CompareChunkEvent,
  CompareColumnInput,
  CompareDoneEvent,
  CompareErrorEvent
} from '../shared/types'
import { getModel } from './providers'

// Side-by-side compare: stream several models against the same prompt at once.
// Ephemeral (nothing persisted) — each run is keyed by a runId so late chunks
// from a stopped/replaced run can be ignored by the renderer.

const activeRuns = new Map<string, AbortController[]>()

export function stopCompare(runId: string): void {
  activeRuns.get(runId)?.forEach((c) => c.abort())
  activeRuns.delete(runId)
}

export async function runCompare(
  sender: WebContents,
  runId: string,
  columns: CompareColumnInput[]
): Promise<void> {
  const controllers = columns.map(() => new AbortController())
  activeRuns.set(runId, controllers)
  const emit = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  await Promise.all(
    columns.map(async (col, index) => {
      const controller = controllers[index]
      try {
        const model = getModel(col.providerId, col.modelId)
        const messages: ModelMessage[] = col.history.map((m) => ({ role: m.role, content: m.content }))
        const result = streamText({ model, messages, abortSignal: controller.signal })
        for await (const part of result.fullStream) {
          if (part.type === 'text-delta') {
            emit('compare:chunk', { runId, index, delta: part.text } satisfies CompareChunkEvent)
          } else if (part.type === 'error') {
            throw part.error instanceof Error ? part.error : new Error(String(part.error))
          }
        }
        const usage = await result.totalUsage
        emit('compare:done', {
          runId,
          index,
          usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
        } satisfies CompareDoneEvent)
      } catch (err) {
        if (controller.signal.aborted) {
          emit('compare:done', { runId, index } satisfies CompareDoneEvent)
        } else {
          emit('compare:error', {
            runId,
            index,
            message: err instanceof Error ? err.message : String(err)
          } satisfies CompareErrorEvent)
        }
      }
    })
  )
  activeRuns.delete(runId)
}
