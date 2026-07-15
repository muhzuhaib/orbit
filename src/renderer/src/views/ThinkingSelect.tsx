// Shared reasoning-effort control. Used in the chat toolbar and every section
// that runs a thinking-capable model (Cowork, Code, Studio). The label ("💭
// Thinking") is shown once, and the dropdown offers just Off / Low / Medium /
// High — instead of repeating "Thinking:" on every option.
import type { JSX } from 'react'

export type Effort = 'off' | 'low' | 'medium' | 'high'

export function ThinkingSelect({
  value,
  onChange,
  disabled = false
}: {
  value: Effort
  onChange: (value: Effort) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <span
      className={`effort-control ${value !== 'off' ? 'thinking-on' : ''}`}
      title="Reasoning effort: how hard the model thinks before answering. Higher = more thorough but slower and uses more tokens. Supported on Anthropic, OpenAI reasoning models, and Gemini."
    >
      <span className="effort-control-label">💭 Thinking</span>
      <select
        className="effort-select"
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(e.target.value as Effort)}
      >
        <option value="off">Off</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </span>
  )
}
