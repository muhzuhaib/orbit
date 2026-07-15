// Shared "how to write mathematics" instruction, injected into every section's
// system prompt so NO model formats maths incorrectly. Two modes:
//   - 'latex'   (default): the app renders LaTeX beautifully with KaTeX.
//   - 'unicode': plain Unicode symbols, for users who prefer copy-paste-friendly
//                text (e.g. dy/dx, x², √, ∫, ≤) instead of LaTeX source.
// The renderer normalises \( \) and \[ \] delimiters before rendering, so the
// instruction only needs to nudge models toward the $…$ / $$…$$ convention.

export type MathFormat = 'latex' | 'unicode'

export function mathInstruction(format: MathFormat): string {
  if (format === 'unicode') {
    return (
      'Mathematics formatting — IMPORTANT: Write ALL mathematics using plain Unicode symbols and ' +
      'ordinary text, NOT LaTeX. Do NOT use $, \\(, \\[, \\frac, \\int or any backslash commands. ' +
      'Use Unicode characters directly: superscripts (x², aⁿ), subscripts (x₁), fractions written ' +
      'inline as a/b or with ⁄, roots (√, ∛), operators and relations (×, ÷, ±, ≤, ≥, ≠, ≈, →, ∞), ' +
      'Greek letters (α, β, θ, π, Σ, Δ), and calculus symbols (∫, ∂, ∇, dy/dx, Σ, ∏, lim). ' +
      'Keep each expression on its own line when it is a displayed equation. Never output raw LaTeX source.'
    )
  }
  return (
    'Mathematics formatting — IMPORTANT: Write ALL mathematics as LaTeX so this app can render it. ' +
    'Wrap inline maths in single dollar signs, e.g. $\\frac{dy}{dx} = 2x$, and displayed equations in ' +
    'double dollar signs on their own lines, e.g. $$\\int \\frac{1}{y}\\,dy = \\int k\\,dx$$. ' +
    'Use proper LaTeX commands (\\frac, \\int, \\sqrt, \\sum, \\lim, \\alpha, \\leq, \\to, superscripts ^ and subscripts _). ' +
    'Do NOT write raw LaTeX without dollar-sign delimiters (never output a bare $\\frac{dy}{dx}$ as literal text), ' +
    'and do NOT wrap maths in code fences. The app converts \\( \\) and \\[ \\] delimiters automatically, but ' +
    'prefer $…$ and $$…$$.'
  )
}
