// Shared extended-thinking / reasoning-effort options for the section agent
// loops (Cowork, Code, Studio). Mirrors chat.ts's per-provider mapping so a
// selected effort turns into the right provider option; models that don't
// support thinking (or effort 'off') get `undefined`, i.e. no behaviour change.
import type { streamText } from 'ai'
import type { ReasoningEffort } from '../shared/types'
import { getProvider } from './registry'
import { supportsThinking } from '../shared/modelCatalog'

export function reasoningProviderOptions(
  providerId: string,
  modelId: string,
  effort: ReasoningEffort | undefined
): Parameters<typeof streamText>[0]['providerOptions'] {
  if (!effort || effort === 'off') return undefined
  const kind = getProvider(providerId)?.kind
  // Never send a thinking option to a model that doesn't accept one.
  if (!supportsThinking(kind, modelId)) return undefined
  const budget = { low: 4000, medium: 10000, high: 24000 }[effort]
  switch (kind) {
    case 'anthropic':
      return { anthropic: { thinking: { type: 'enabled', budgetTokens: budget } } }
    case 'openai':
      return { openai: { reasoningEffort: effort } }
    case 'google':
      return { google: { thinkingConfig: { includeThoughts: true, thinkingBudget: budget } } }
    default:
      return undefined
  }
}
