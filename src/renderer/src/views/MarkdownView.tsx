// Shared markdown renderer used by every view that shows model output (Chat,
// Compare, Cowork, Code, Swarm, Council). Centralising it means the maths fix
// (remark-math + rehype-katex, plus \( \) / \[ \] delimiter normalisation),
// GitHub-flavoured markdown + code highlighting, and the code-block copy button
// all apply everywhere consistently.
import { isValidElement, useRef, useState, type JSX, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
import { normalizeMath } from '../mathFormat'

const REMARK = [remarkGfm, remarkMath]
const REHYPE = [rehypeHighlight, rehypeKatex]

// Pull the language out of the <code class="language-xxx"> that rehype-highlight
// produces, so the code-block header can label it (falls back to "code").
function codeLang(children: ReactNode): string {
  if (isValidElement<{ className?: string }>(children)) {
    const m = /language-(\w+)/.exec(children.props.className ?? '')
    if (m) return m[1]
  }
  return 'code'
}

// Every fenced code block gets a header bar: the language label on the left and
// an always-visible "Copy" button on the right (Claude/GitHub style). The text
// is read straight from the rendered <pre> so highlighting spans don't matter.
function CodeBlock({ children }: { children?: ReactNode }): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    const text = preRef.current?.innerText ?? ''
    if (!text) return
    navigator.clipboard.writeText(text.replace(/\n$/, ''))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-lang">{codeLang(children)}</span>
        <button className="code-copy" onClick={copy} title="Copy code">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

const COMPONENTS = { pre: CodeBlock }

export function MarkdownView({ children }: { children: string }): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
      {normalizeMath(children ?? '')}
    </ReactMarkdown>
  )
}
