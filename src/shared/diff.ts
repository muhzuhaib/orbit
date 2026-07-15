/**
 * Line-based diff (classic LCS) for the Cowork diff viewer.
 * Electron-free so plain Node can unit-test it. No dependencies.
 */

export type DiffLine = { t: 'same' | 'add' | 'del'; text: string }
export type DiffBlock = DiffLine | { t: 'skip'; count: number }

/** Above this many lines on either side we skip diffing (O(n·m) memory). */
const MAX_DIFF_LINES = 2000

function splitLines(s: string): string[] {
  return s === '' ? [] : s.split(/\r\n|\r|\n/)
}

/**
 * Diff two texts line by line. Returns null when either side is too large
 * to diff cheaply (caller should show a "too large to preview" note).
 */
export function diffLines(oldText: string, newText: string): DiffLine[] | null {
  const a = splitLines(oldText)
  const b = splitLines(newText)
  const n = a.length
  const m = b.length
  if (n > MAX_DIFF_LINES || m > MAX_DIFF_LINES) return null

  // dp[i][j] = LCS length of a[i:] vs b[j:], flattened
  const w = m + 1
  const dp = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] =
        a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }

  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: 'same', text: a[i] })
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      out.push({ t: 'del', text: a[i] })
      i++
    } else {
      out.push({ t: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ t: 'del', text: a[i++] })
  while (j < m) out.push({ t: 'add', text: b[j++] })
  return out
}

/** "+12 −3" style summary. */
export function diffSummary(lines: DiffLine[]): string {
  let add = 0
  let del = 0
  for (const l of lines) {
    if (l.t === 'add') add++
    else if (l.t === 'del') del++
  }
  return `+${add} −${del}`
}

/**
 * Git-style context collapsing: keep `context` unchanged lines around every
 * change, fold the rest into { t: 'skip', count } blocks.
 */
export function collapseContext(lines: DiffLine[], context = 3): DiffBlock[] {
  const keep = new Array<boolean>(lines.length).fill(false)
  for (let idx = 0; idx < lines.length; idx++) {
    if (lines[idx].t !== 'same') {
      for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) {
        keep[k] = true
      }
    }
  }
  const out: DiffBlock[] = []
  let skip = 0
  for (let idx = 0; idx < lines.length; idx++) {
    if (keep[idx]) {
      if (skip > 0) {
        out.push({ t: 'skip', count: skip })
        skip = 0
      }
      out.push(lines[idx])
    } else {
      skip++
    }
  }
  if (skip > 0) out.push({ t: 'skip', count: skip })
  return out
}
