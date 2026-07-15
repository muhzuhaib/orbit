import { getConfig, getKey } from './settings'

export interface Embedder {
  /** stable identifier stored with chunks so retrieval uses the same space */
  id: string
  embed(texts: string[]): Promise<number[][]>
}

const EMBED_MODEL_HINTS = ['embed', 'bge', 'minilm']

/**
 * Best available embedder, in order of preference:
 *  1. Local Ollama with an embedding model installed (free, private)
 *  2. OpenAI text-embedding-3-small (needs saved key)
 *  3. Google text-embedding-004 (needs saved key)
 *  4. null → caller falls back to keyword retrieval
 */
export async function resolveEmbedder(): Promise<Embedder | null> {
  const ollama = await ollamaEmbedder()
  if (ollama) return ollama

  const openaiKey = getKey('openai')
  if (openaiKey) {
    return {
      id: 'openai/text-embedding-3-small',
      embed: (texts) =>
        openAiStyleEmbed('https://api.openai.com/v1/embeddings', openaiKey, 'text-embedding-3-small', texts)
    }
  }

  const googleKey = getKey('google')
  if (googleKey) {
    return {
      id: 'google/text-embedding-004',
      embed: (texts) => googleEmbed(googleKey, texts)
    }
  }

  return null
}

/** Re-create an embedder by stored id (for query-time embedding). */
export async function embedderById(id: string): Promise<Embedder | null> {
  if (id.startsWith('ollama/')) {
    const model = id.slice('ollama/'.length)
    const url = getConfig().ollamaUrl
    if (!(await ollamaHasModel(url, model))) return null
    return { id, embed: (texts) => ollamaEmbed(url, model, texts) }
  }
  const resolved = await resolveEmbedder()
  return resolved?.id === id ? resolved : null
}

async function ollamaEmbedder(): Promise<Embedder | null> {
  const url = getConfig().ollamaUrl
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return null
    const data = (await res.json()) as { models?: { name: string }[] }
    const model = (data.models ?? [])
      .map((m) => m.name)
      .find((name) => EMBED_MODEL_HINTS.some((h) => name.toLowerCase().includes(h)))
    if (!model) return null
    return { id: `ollama/${model}`, embed: (texts) => ollamaEmbed(url, model, texts) }
  } catch {
    return null
  }
}

async function ollamaHasModel(url: string, model: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return false
    const data = (await res.json()) as { models?: { name: string }[] }
    return (data.models ?? []).some((m) => m.name === model)
  } catch {
    return false
  }
}

async function ollamaEmbed(url: string, model: string, texts: string[]): Promise<number[][]> {
  const res = await fetch(`${url}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(60000)
  })
  if (!res.ok) throw new Error(`Ollama embed failed: HTTP ${res.status}`)
  const data = (await res.json()) as { embeddings: number[][] }
  return data.embeddings
}

async function openAiStyleEmbed(
  url: string,
  key: string,
  model: string,
  texts: string[]
): Promise<number[][]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(60000)
  })
  if (!res.ok) throw new Error(`Embedding request failed: HTTP ${res.status}`)
  const data = (await res.json()) as { data: { index: number; embedding: number[] }[] }
  return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
}

async function googleEmbed(key: string, texts: string[]): Promise<number[][]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=${encodeURIComponent(key)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: texts.map((t) => ({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: t }] }
        }))
      }),
      signal: AbortSignal.timeout(60000)
    }
  )
  if (!res.ok) throw new Error(`Google embedding failed: HTTP ${res.status}`)
  const data = (await res.json()) as { embeddings: { values: number[] }[] }
  return data.embeddings.map((e) => e.values)
}

