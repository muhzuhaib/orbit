import { generateText } from 'ai'
import type { VerifyClaim, VerifyClaimStatus, VerifyInput, VerifyReport, VerifyVerdict } from '../shared/types'
import { getModel } from './providers'
import { webSearch } from './chat'

// "Verify" = a hallucination check. Take an assistant answer, optionally pull
// live web evidence, then ask a verifier model to break the answer into factual
// claims, rate each (supported / unsupported / contradicted / uncertain) and
// give an overall verdict + confidence. Non-streaming: one (optionally two)
// generateText calls. Reuses the proven getModel + generateText path — no new
// provider wiring. It is a strong signal, not proof (an AI checking an AI).

const VERDICTS: VerifyVerdict[] = ['looks-solid', 'some-risks', 'likely-issues', 'uncertain']
const STATUSES: VerifyClaimStatus[] = ['supported', 'unsupported', 'contradicted', 'uncertain']

export async function verifyAnswer(input: VerifyInput): Promise<VerifyReport> {
  const { providerId, modelId, question, answer, useWeb } = input
  if (!answer.trim()) {
    return { verdict: 'uncertain', confidence: null, summary: 'Nothing to check — the answer is empty.', claims: [] }
  }

  const model = getModel(providerId, modelId)

  // 1) Optional web grounding: ask the model for up to 3 focused search queries,
  //    run them, and collect the results as evidence. Best-effort throughout —
  //    if any of it fails we fall back to a model-only (self-critique) check.
  let evidence = ''
  let queries: string[] = []
  if (useWeb) {
    try {
      const { text: qtext } = await generateText({
        model,
        prompt:
          'You are fact-checking an AI answer. Write up to 3 short web-search queries that would best ' +
          'verify the concrete FACTUAL claims in the answer (names, dates, numbers, events, quotes). ' +
          'Output ONLY the queries, one per line, no numbering, no commentary.\n\n' +
          `QUESTION:\n${question.slice(0, 1500)}\n\nANSWER:\n${answer.slice(0, 4000)}`
      })
      queries = qtext
        .split('\n')
        .map((s) => s.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((s) => s.length > 0)
        .slice(0, 3)
      if (queries.length > 0) {
        const results = await Promise.all(queries.map((q) => webSearch(q).catch(() => '')))
        evidence = results
          .map((r, i) => `### Web results for: ${queries[i]}\n${r}`)
          .join('\n\n')
          .slice(0, 8000)
      }
    } catch {
      // web grounding is optional — proceed with a model-only check
    }
  }
  const grounded = useWeb && evidence.trim().length > 0

  // 2) The check itself. Ask for STRICT JSON so we can render a structured panel.
  const system =
    'You are a meticulous fact-checker whose job is to catch hallucinations and errors in ' +
    'AI-generated answers. Be skeptical and specific. Judge ONLY factual accuracy — not style, ' +
    'tone, or completeness. Opinions, clearly-hedged statements, and subjective advice are not ' +
    'hallucinations. ' +
    (grounded
      ? 'Use the provided web search results as your primary evidence; if a claim is not supported by them, say so.'
      : 'You have no web access, so judge against your own knowledge and internal consistency; be honest about uncertainty.') +
    '\n\nReturn ONLY a JSON object, no prose around it, with this exact shape:\n' +
    '{\n' +
    '  "verdict": "looks-solid" | "some-risks" | "likely-issues" | "uncertain",\n' +
    '  "confidence": <integer 0-100, your confidence the answer is free of factual errors>,\n' +
    '  "summary": "<1-2 sentences in plain language>",\n' +
    '  "claims": [ { "claim": "<a specific factual claim from the answer>", ' +
    '"status": "supported" | "unsupported" | "contradicted" | "uncertain", "note": "<short reason>" } ]\n' +
    '}\n' +
    'Include the most important 3-8 checkable claims. If the answer contains no checkable factual ' +
    'claims, return an empty claims array, verdict "looks-solid" and a summary saying so.'

  const prompt =
    `USER QUESTION:\n${question.slice(0, 3000)}\n\n` +
    `AI ANSWER TO CHECK:\n${answer.slice(0, 12000)}\n\n` +
    (grounded ? `WEB SEARCH EVIDENCE:\n${evidence}\n\n` : '') +
    'Now produce the JSON verdict.'

  let raw = ''
  try {
    const { text } = await generateText({ model, system, prompt })
    raw = text
  } catch (err) {
    return {
      verdict: 'uncertain',
      confidence: null,
      summary: `The verification model could not be reached: ${err instanceof Error ? err.message : String(err)}`,
      claims: [],
      usedWeb: grounded,
      queries,
      error: 'model-failed'
    }
  }

  const report = parseReport(raw)
  report.usedWeb = grounded
  report.queries = queries
  return report
}

/** Pull the JSON object out of the model's reply and coerce it into a valid
 *  VerifyReport. Tolerant of code fences / stray prose; never throws. */
function parseReport(raw: string): VerifyReport {
  const fallback: VerifyReport = {
    verdict: 'uncertain',
    confidence: null,
    summary: raw.trim().slice(0, 600) || 'The check did not return a readable result.',
    claims: []
  }
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return fallback
  let obj: unknown
  try {
    obj = JSON.parse(match[0])
  } catch {
    return fallback
  }
  if (typeof obj !== 'object' || obj === null) return fallback
  const o = obj as Record<string, unknown>

  const verdict: VerifyVerdict = VERDICTS.includes(o.verdict as VerifyVerdict)
    ? (o.verdict as VerifyVerdict)
    : 'uncertain'
  let confidence: number | null = null
  if (typeof o.confidence === 'number' && isFinite(o.confidence)) {
    confidence = Math.max(0, Math.min(100, Math.round(o.confidence)))
  }
  const summary = typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim() : fallback.summary
  const claims: VerifyClaim[] = Array.isArray(o.claims)
    ? o.claims
        .map((c): VerifyClaim | null => {
          if (typeof c !== 'object' || c === null) return null
          const cc = c as Record<string, unknown>
          const claim = typeof cc.claim === 'string' ? cc.claim.trim() : ''
          if (!claim) return null
          const status: VerifyClaimStatus = STATUSES.includes(cc.status as VerifyClaimStatus)
            ? (cc.status as VerifyClaimStatus)
            : 'uncertain'
          const note = typeof cc.note === 'string' ? cc.note.trim() : undefined
          return { claim, status, note }
        })
        .filter((c): c is VerifyClaim => c !== null)
        .slice(0, 12)
    : []

  return { verdict, confidence, summary, claims }
}
