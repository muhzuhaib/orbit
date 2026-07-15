import { streamText } from 'ai'
import type { WebContents } from 'electron'
import type {
  CouncilAnswerChunkEvent,
  CouncilAnswerDoneEvent,
  CouncilDoneEvent,
  CouncilErrorEvent,
  CouncilRunInput,
  CouncilStatusEvent,
  CouncilVerdictChunkEvent
} from '../shared/types'
import { getModel } from './providers'
import { getMathFormat } from './settings'
import { mathInstruction } from '../shared/mathPrompt'

// Council mode: send one prompt to several models (in parallel), then a judge
// model reads all the answers and writes a verdict — agreements, contradictions,
// and a synthesised final answer. Ephemeral (nothing persisted); reuses the same
// streaming approach as Compare, so chat storage is never touched.

const activeRuns = new Map<string, AbortController[]>()

export function stopCouncil(runId: string): void {
  activeRuns.get(runId)?.forEach((c) => c.abort())
  activeRuns.delete(runId)
}

export async function runCouncil(
  sender: WebContents,
  runId: string,
  input: CouncilRunInput
): Promise<void> {
  const { prompt, panelists, judge } = input
  const controllers: AbortController[] = []
  const newController = (): AbortController => {
    const c = new AbortController()
    controllers.push(c)
    return c
  }
  activeRuns.set(runId, controllers)
  const emit = (channel: string, payload: unknown): void => {
    if (!sender.isDestroyed()) sender.send(channel, payload)
  }

  const answers: string[] = panelists.map(() => '')

  try {
    // 1) Panelists answer in parallel.
    await Promise.all(
      panelists.map(async (p, index) => {
        const controller = newController()
        try {
          const result = streamText({
            model: getModel(p.providerId, p.modelId),
            system: mathInstruction(getMathFormat()),
            prompt,
            abortSignal: controller.signal
          })
          for await (const part of result.fullStream) {
            if (part.type === 'text-delta') {
              answers[index] += part.text
              emit('council:answer-chunk', { runId, index, delta: part.text } satisfies CouncilAnswerChunkEvent)
            } else if (part.type === 'error') {
              throw part.error instanceof Error ? part.error : new Error(String(part.error))
            }
          }
          emit('council:answer-done', { runId, index } satisfies CouncilAnswerDoneEvent)
        } catch (err) {
          if (controller.signal.aborted) {
            emit('council:answer-done', { runId, index } satisfies CouncilAnswerDoneEvent)
          } else {
            const message = err instanceof Error ? err.message : String(err)
            answers[index] = `[failed: ${message}]`
            emit('council:answer-done', { runId, index, error: message } satisfies CouncilAnswerDoneEvent)
          }
        }
      })
    )

    if (controllers.some((c) => c.signal.aborted)) {
      emit('council:done', { runId } satisfies CouncilDoneEvent)
      return
    }

    // 2) Judge writes the verdict.
    emit('council:status', { runId, text: 'Judge is weighing the answers…' } satisfies CouncilStatusEvent)
    const answersBlock = panelists
      .map((p, i) => `### ${p.label}\n${answers[i] || '(no answer)'}`)
      .join('\n\n')
    const judgePrompt = [
      'You are the impartial JUDGE of a council of AI models that each answered the same question.',
      'Read every answer and write a clear verdict using EXACTLY these markdown sections:',
      '',
      '## Where they agree',
      '## Where they differ',
      '## Final answer',
      '',
      'Under "Final answer", give your single best synthesised answer to the question, resolving any',
      'conflicts and correcting mistakes you noticed. Be concise and decisive. Do not just restate',
      'each model — judge them.',
      '',
      `QUESTION:\n${prompt}`,
      '',
      `ANSWERS FROM THE COUNCIL:\n${answersBlock}`
    ].join('\n')

    const verdict = streamText({
      model: getModel(judge.providerId, judge.modelId),
      system: mathInstruction(getMathFormat()),
      prompt: judgePrompt,
      abortSignal: newController().signal
    })
    for await (const part of verdict.fullStream) {
      if (part.type === 'text-delta') {
        emit('council:verdict-chunk', { runId, delta: part.text } satisfies CouncilVerdictChunkEvent)
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error(String(part.error))
      }
    }
    emit('council:done', { runId } satisfies CouncilDoneEvent)
  } catch (err) {
    if (controllers.some((c) => c.signal.aborted)) {
      emit('council:done', { runId } satisfies CouncilDoneEvent)
    } else {
      emit('council:error', {
        runId,
        message: err instanceof Error ? err.message : String(err)
      } satisfies CouncilErrorEvent)
    }
  } finally {
    activeRuns.delete(runId)
  }
}
