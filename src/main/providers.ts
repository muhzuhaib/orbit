import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { wrapLanguageModel, type LanguageModel, type LanguageModelMiddleware } from 'ai'
import type { TestResult } from '../shared/types'
import { getKey } from './settings'
import { getProvider } from './registry'

/**
 * Strip the model's own reasoning ("thinking") parts out of assistant messages
 * before they are sent back to the provider. During a multi-step tool-call loop
 * the AI SDK re-sends the previous assistant turn — including its reasoning — on
 * the next step. Some OpenAI-compatible providers (Groq, Ollama Cloud gpt-oss)
 * reject the resulting `reasoning_content` field with an error like
 *   'messages.2' … property 'reasoning_content' is unsupported
 * which broke tool flows such as "save this to memory". We never need to send
 * reasoning back, so dropping it makes those flows work everywhere.
 */
const stripReasoningMiddleware: LanguageModelMiddleware = {
  transformParams: async ({ params }) => {
    const prompt = params.prompt.map((m) =>
      m.role === 'assistant' && Array.isArray(m.content)
        ? { ...m, content: m.content.filter((p) => p.type !== 'reasoning') }
        : m
    )
    return { ...params, prompt }
  }
}

/**
 * Resolve a (providerId, modelId) pair to an AI SDK model instance.
 * This is the single entry point the chat/Cowork layers use — they never
 * talk to provider SDKs directly.
 */
export function getModel(providerId: string, modelId: string): LanguageModel {
  const provider = getProvider(providerId)
  if (!provider) throw new Error(`Unknown provider: ${providerId}`)
  const apiKey = getKey(providerId) ?? undefined
  if (provider.needsKey && !apiKey) {
    throw new Error(`No API key saved for ${provider.label}. Add one in Providers.`)
  }

  switch (provider.kind) {
    case 'anthropic':
      return createAnthropic({ apiKey })(modelId)
    case 'openai':
      return createOpenAI({ apiKey })(modelId)
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(modelId)
    case 'openai-compat': {
      const baseURL =
        providerId === 'ollama'
          ? `${provider.baseURL ?? 'http://localhost:11434'}/v1`
          : provider.baseURL
      if (!baseURL) throw new Error(`Provider ${provider.label} has no base URL configured.`)
      // includeUsage: ask for token usage on streamed responses (stream_options.include_usage)
      const compat = createOpenAICompatible({ name: provider.label, baseURL, apiKey, includeUsage: true })(modelId)
      // Wrap so echoed reasoning never reaches providers that reject it (Groq etc.)
      return wrapLanguageModel({ model: compat, middleware: stripReasoningMiddleware })
    }
  }
}

/**
 * Validate connectivity + credentials with a free API call (model listing),
 * so testing a key never spends tokens.
 */
export async function testProvider(providerId: string): Promise<TestResult> {
  const provider = getProvider(providerId)
  if (!provider) return { ok: false, message: 'Unknown provider' }
  const key = getKey(providerId)
  if (provider.needsKey && !key) return { ok: false, message: 'No API key saved' }

  // ollama.com's /models endpoint is PUBLIC, so listing proves nothing about
  // the key — make a real 1-token authenticated call instead.
  if ((provider.baseURL ?? '').includes('ollama.com')) {
    try {
      const res = await fetch(`${provider.baseURL!.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-oss:20b',
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1
        }),
        signal: AbortSignal.timeout(15000)
      })
      if (res.ok) return { ok: true, message: 'Connected — credentials valid' }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, message: 'Authentication failed — the key is invalid or expired. Get a new one at ollama.com → Settings → API Keys.' }
      }
      if (res.status === 429) {
        return { ok: false, message: 'Key is valid but the account is out of usage quota right now (rate/usage limit).' }
      }
      return { ok: false, message: `Provider responded with HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, message: `Connection failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  let url: string
  const headers: Record<string, string> = {}
  switch (provider.kind) {
    case 'anthropic':
      url = 'https://api.anthropic.com/v1/models'
      headers['x-api-key'] = key!
      headers['anthropic-version'] = '2023-06-01'
      break
    case 'openai':
      url = 'https://api.openai.com/v1/models'
      headers['Authorization'] = `Bearer ${key}`
      break
    case 'google':
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key!)}`
      break
    case 'openai-compat': {
      const base =
        providerId === 'ollama'
          ? `${provider.baseURL ?? 'http://localhost:11434'}/v1`
          : provider.baseURL
      if (!base) return { ok: false, message: 'No base URL configured' }
      url = `${base.replace(/\/$/, '')}/models`
      if (key) headers['Authorization'] = `Bearer ${key}`
      break
    }
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (res.ok) return { ok: true, message: 'Connected — credentials valid' }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Authentication failed (HTTP ${res.status}) — check the API key` }
    }
    return { ok: false, message: `Provider responded with HTTP ${res.status}` }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Connection failed: ${msg}` }
  }
}
