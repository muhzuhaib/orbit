// Best-effort model pricing so the per-chat dashboard can estimate cost.
// Electron-free so plain Node can unit-test it.
//
// Prices are USD per 1,000,000 tokens (input / output), taken from each
// provider's public pricing at the time of writing. They CHANGE over time and
// vary by tier, so treat every number here as an estimate — the UI labels it as
// such. Local models (Ollama) are free. Unknown models return null (the UI then
// shows tokens only, no cost).

export interface ModelRate {
  /** USD per 1M input tokens */
  input: number
  /** USD per 1M output tokens */
  output: number
}

// providerId → ordered list of [pattern, rate]. First matching pattern wins, so
// put more specific patterns (mini/nano/lite) before the general family.
const RATES: Record<string, [RegExp, ModelRate][]> = {
  anthropic: [
    [/haiku/i, { input: 0.8, output: 4 }],
    [/opus/i, { input: 15, output: 75 }],
    [/sonnet/i, { input: 3, output: 15 }]
  ],
  openai: [
    [/gpt-5-nano/i, { input: 0.05, output: 0.4 }],
    [/gpt-5-mini/i, { input: 0.25, output: 2 }],
    [/gpt-5/i, { input: 1.25, output: 10 }],
    [/gpt-4\.1-nano/i, { input: 0.1, output: 0.4 }],
    [/gpt-4\.1-mini/i, { input: 0.4, output: 1.6 }],
    [/gpt-4\.1/i, { input: 2, output: 8 }],
    [/gpt-4o-mini/i, { input: 0.15, output: 0.6 }],
    [/gpt-4o|chatgpt-4o/i, { input: 2.5, output: 10 }],
    [/o4-mini|o3-mini|o1-mini/i, { input: 1.1, output: 4.4 }],
    [/o3|o1/i, { input: 15, output: 60 }],
    [/gpt-4-turbo/i, { input: 10, output: 30 }],
    [/gpt-3\.5/i, { input: 0.5, output: 1.5 }]
  ],
  google: [
    [/flash-lite/i, { input: 0.1, output: 0.4 }],
    [/flash/i, { input: 0.3, output: 2.5 }],
    [/pro/i, { input: 1.25, output: 10 }]
  ],
  deepseek: [
    [/reasoner|r1/i, { input: 0.55, output: 2.19 }],
    [/chat|v3/i, { input: 0.27, output: 1.1 }]
  ],
  qwen: [
    [/turbo/i, { input: 0.05, output: 0.2 }],
    [/plus/i, { input: 0.4, output: 1.2 }],
    [/max/i, { input: 1.6, output: 6.4 }]
  ],
  glm: [
    [/air/i, { input: 0.2, output: 1.1 }],
    [/4\.6|4\.5/i, { input: 0.6, output: 2.2 }]
  ],
  kimi: [
    [/128k/i, { input: 2, output: 5 }],
    [/32k/i, { input: 1, output: 3 }],
    [/8k/i, { input: 0.2, output: 2 }],
    [/k2|kimi/i, { input: 0.6, output: 2.5 }]
  ]
}

/** Free local/keyless providers — always $0. */
const FREE_PROVIDERS = new Set(['ollama', 'ollama-cloud'])

/**
 * Price for a model, or null when unknown. providerId is the Orbit provider id;
 * modelId is the raw model id.
 */
export function modelPrice(providerId: string, modelId: string): ModelRate | null {
  if (FREE_PROVIDERS.has(providerId)) return { input: 0, output: 0 }
  const table = RATES[providerId]
  if (!table) return null
  for (const [re, rate] of table) if (re.test(modelId)) return rate
  return null
}

/** Cost in USD for a number of input/output tokens, or null when price unknown. */
export function estimateCost(
  providerId: string,
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number | null {
  const rate = modelPrice(providerId, modelId)
  if (!rate) return null
  return (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
}

/** Format a USD cost for display (handles sub-cent amounts). */
export function formatCost(usd: number): string {
  if (usd === 0) return 'free'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  if (usd < 1) return `$${usd.toFixed(3)}`
  return `$${usd.toFixed(2)}`
}
