/** Pure RAG helpers — no Electron imports so they're unit-testable with plain Node. */

/** Paragraph-aware chunking: ~1200 chars per chunk with one-paragraph overlap. */
export function chunkText(text: string, targetSize = 1200): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current: string[] = []
  let size = 0

  const flush = () => {
    if (current.length > 0) {
      chunks.push(current.join('\n\n'))
      const last = current[current.length - 1]
      current = last.length < targetSize / 2 ? [last] : []
      size = current.reduce((n, s) => n + s.length, 0)
    }
  }

  for (let para of paragraphs) {
    // hard-split monster paragraphs
    while (para.length > targetSize * 2) {
      chunks.push(para.slice(0, targetSize * 2))
      para = para.slice(targetSize * 2 - 200)
    }
    if (size + para.length > targetSize && current.length > 0) flush()
    current.push(para)
    size += para.length
  }
  if (current.length > 0) chunks.push(current.join('\n\n'))
  return chunks
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** Cheap lexical relevance for when no embedder is available. */
export function keywordScore(query: string, text: string): number {
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2)
  if (words.length === 0) return 0
  const lower = text.toLowerCase()
  let score = 0
  for (const w of words) {
    let idx = lower.indexOf(w)
    while (idx !== -1) {
      score++
      idx = lower.indexOf(w, idx + w.length)
    }
  }
  return score / Math.sqrt(text.length)
}
