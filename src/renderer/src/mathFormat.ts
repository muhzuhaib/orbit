// Renderer-side maths helpers.
//
// normalizeMath: models emit LaTeX with several delimiter styles. remark-math
// only understands $…$ and $$…$$, so we convert the \( \) (inline) and \[ \]
// (display) forms to dollar delimiters BEFORE rendering. This — combined with
// the remark-math/rehype-katex pipeline in MarkdownView — is the built-in fix
// that makes maths render correctly no matter which model produced it.
//
// We deliberately skip conversions inside fenced/inline code so real code that
// contains \( or \[ is left untouched.

export function normalizeMath(src: string): string {
  if (!src) return src
  // Split on code spans/fences so we never rewrite delimiters inside code.
  // Matches ```fenced blocks``` and `inline code`.
  const parts = src.split(/(```[\s\S]*?```|`[^`\n]*`)/g)
  return parts
    .map((seg, i) => {
      // odd indices are the captured code segments — leave them as-is
      if (i % 2 === 1) return seg
      return seg
        .replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `$$${body}$$`)
        .replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`)
    })
    .join('')
}
