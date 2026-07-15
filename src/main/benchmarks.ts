import { app } from 'electron'
import type { WebContents } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { generateText } from 'ai'
import type {
  BenchmarkData,
  BenchmarkPrompt,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkRunInput
} from '../shared/types'
import { getModel } from './providers'
import { estimateCost } from '../shared/modelPricing'

// Personal benchmarks (beta): the user saves their own test prompts and runs
// them across chosen models; a judge model scores each answer 1–10. Stored in a
// NEW file (benchmarks.json) so it's fully additive — reverting to v0.9.3 is safe.

const MAX_PROMPTS = 10
const MAX_HISTORY = 20

function file(): string {
  return join(app.getPath('userData'), 'benchmarks.json')
}

export function getBenchmarks(): BenchmarkData {
  try {
    if (existsSync(file())) {
      const d = JSON.parse(readFileSync(file(), 'utf-8')) as BenchmarkData
      return { prompts: d.prompts ?? [], history: d.history ?? [] }
    }
  } catch {
    // ignore corrupt file
  }
  return { prompts: [], history: [] }
}

function save(data: BenchmarkData): BenchmarkData {
  writeFileSync(file(), JSON.stringify(data, null, 2), 'utf-8')
  return data
}

export function savePrompts(prompts: BenchmarkPrompt[]): BenchmarkData {
  const data = getBenchmarks()
  data.prompts = prompts.slice(0, MAX_PROMPTS)
  return save(data)
}

const active = new Map<string, AbortController>()
export function stopBenchmark(runId: string): void {
  active.get(runId)?.abort()
  active.delete(runId)
}

/** Pull the first integer 1–10 out of a judge reply. */
function parseScore(text: string): number {
  const m = text.match(/\b(10|[1-9])\b/)
  const n = m ? parseInt(m[1], 10) : 0
  return Math.max(0, Math.min(10, n))
}

export async function runBenchmark(
  sender: WebContents,
  runId: string,
  input: BenchmarkRunInput
): Promise<BenchmarkRun | null> {
  const controller = new AbortController()
  active.set(runId, controller)
  const emit = (text: string): void => {
    if (!sender.isDestroyed()) sender.send('benchmark:progress', { runId, text })
  }

  const { prompts, models, judge } = input
  const results: BenchmarkResult[] = []
  const total = prompts.length * models.length

  try {
    let done = 0
    for (const prompt of prompts) {
      // Each model answers this prompt (in parallel).
      const answers = await Promise.all(
        models.map(async (mdl) => {
          const start = Date.now()
          try {
            const { text, usage } = await generateText({
              model: getModel(mdl.providerId, mdl.modelId),
              prompt: prompt.text,
              abortSignal: controller.signal
            })
            const seconds = (Date.now() - start) / 1000
            const cost = estimateCost(
              mdl.providerId,
              mdl.modelId,
              usage?.inputTokens ?? 0,
              usage?.outputTokens ?? 0
            )
            return { text, seconds, cost, error: undefined as string | undefined }
          } catch (err) {
            return {
              text: '',
              seconds: (Date.now() - start) / 1000,
              cost: null,
              error: err instanceof Error ? err.message : String(err)
            }
          } finally {
            done++
            emit(`Answering “${prompt.text.slice(0, 40)}”… (${done}/${total})`)
          }
        })
      )

      // Judge scores every answer for this prompt in one call.
      let scores: number[] = models.map(() => 0)
      const scorable = answers.some((a) => a.text && !a.error)
      if (scorable) {
        emit(`Scoring answers for “${prompt.text.slice(0, 40)}”…`)
        try {
          const block = models
            .map((_, i) => `### Answer ${i + 1}\n${answers[i].error ? '(failed to answer)' : answers[i].text || '(empty)'}`)
            .join('\n\n')
          const { text } = await generateText({
            model: getModel(judge.providerId, judge.modelId),
            prompt: [
              'You are a strict grader. Score how well each answer responds to the question on a',
              'scale of 1 to 10 (10 = excellent, correct, complete; 1 = poor or wrong).',
              `Reply with ONLY a JSON array of ${models.length} integers, e.g. [7,4,9]. No prose.`,
              '',
              `QUESTION:\n${prompt.text}`,
              '',
              block
            ].join('\n'),
            abortSignal: controller.signal
          })
          const arr = JSON.parse((text.match(/\[[\s\S]*?\]/) ?? ['[]'])[0]) as unknown[]
          scores = models.map((_, i) => {
            const v = Number(arr[i])
            return Number.isFinite(v) ? Math.max(0, Math.min(10, Math.round(v))) : parseScore(String(arr[i] ?? ''))
          })
        } catch {
          scores = models.map(() => 0)
        }
      }

      models.forEach((mdl, i) => {
        results.push({
          promptId: prompt.id,
          promptText: prompt.text,
          model: `${mdl.providerId}/${mdl.modelId}`,
          modelLabel: mdl.label,
          score: answers[i].error ? 0 : scores[i],
          seconds: Math.round(answers[i].seconds * 10) / 10,
          cost: answers[i].cost,
          error: answers[i].error
        })
      })
    }

    const run: BenchmarkRun = {
      id: runId,
      at: Date.now(),
      judgeModel: judge.label,
      results
    }
    const data = getBenchmarks()
    data.history = [run, ...data.history].slice(0, MAX_HISTORY)
    save(data)
    if (!sender.isDestroyed()) sender.send('benchmark:done', { runId, run })
    return run
  } catch (err) {
    if (!sender.isDestroyed()) {
      if (controller.signal.aborted) sender.send('benchmark:done', { runId, run: null })
      else sender.send('benchmark:error', { runId, message: err instanceof Error ? err.message : String(err) })
    }
    return null
  } finally {
    active.delete(runId)
  }
}
