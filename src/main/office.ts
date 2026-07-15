import { dialog, type BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { marked, type Token, type Tokens } from 'marked'

// ---------- Loading (extraction) ----------

/** Excel/CSV → readable text: one "## Sheet: name" section per sheet, rows as CSV. */
export async function extractXlsx(buffer: Buffer): Promise<string> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buffer, { type: 'buffer' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    parts.push(`## Sheet: ${name}\n${csv}`)
  }
  return parts.join('\n\n')
}

/** PowerPoint → slide-by-slide text (reads a:t runs from each slide's XML). */
export async function extractPptx(buffer: Buffer): Promise<string> {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(buffer)
  const slideNames = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => slideNum(a) - slideNum(b))
  const parts: string[] = []
  for (const name of slideNames) {
    const xml = await zip.files[name].async('string')
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => decodeXml(m[1]))
    parts.push(`## Slide ${slideNum(name)}\n${texts.filter(Boolean).join('\n')}`)
  }
  return parts.join('\n\n')
}

const slideNum = (name: string): number => parseInt(name.match(/slide(\d+)\.xml$/)?.[1] ?? '0', 10)

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

// ---------- Generation (export) ----------

export type OfficeFormat = 'docx' | 'xlsx' | 'pptx'

/**
 * Markdown → Office file bytes. THE single conversion entry point: the export
 * buttons under replies AND the create_document chat tool both use it, so any
 * model — even one that "can't make files" — gets native Office output.
 */
export async function buildOfficeBuffer(
  format: OfficeFormat,
  markdown: string,
  title: string
): Promise<Buffer> {
  if (format === 'docx') return buildDocxBuffer(markdown, title)
  if (format === 'xlsx') return buildXlsxBuffer(markdown)
  return buildPptxBuffer(markdown, title)
}

/** Markdown → .docx bytes (markdown → HTML → OOXML). */
async function buildDocxBuffer(markdown: string, title: string): Promise<Buffer> {
  const html = await marked.parse(markdown)
  const { default: HTMLtoDOCX } = await import('html-to-docx')
  const buffer = await HTMLtoDOCX(`<!DOCTYPE html><html><body>${html}</body></html>`, null, {
    title,
    font: 'Calibri'
  })
  return Buffer.from(buffer as ArrayBuffer)
}

/**
 * Markdown → .xlsx: every markdown table becomes a sheet; if there are no tables,
 * the text lines go into a single-column sheet.
 */
async function buildXlsxBuffer(markdown: string): Promise<Buffer> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const tokens = marked.lexer(markdown)
  let tableIdx = 0

  for (const token of tokens) {
    if (token.type === 'table') {
      const t = token as Tokens.Table
      const aoa: string[][] = [t.header.map((h) => h.text), ...t.rows.map((r) => r.map((c) => c.text))]
      tableIdx++
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), `Table ${tableIdx}`.slice(0, 31))
    }
  }
  if (tableIdx === 0) {
    const lines = markdown.split('\n').map((l) => [l])
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lines), 'Content')
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

/**
 * Markdown → .pptx: H1/H2 headings start new slides (heading = slide title),
 * paragraphs and list items become bullets. Content before the first heading
 * lands on an untitled slide.
 */
async function buildPptxBuffer(markdown: string, defaultName: string): Promise<Buffer> {
  const { default: PptxGenJS } = await import('pptxgenjs')
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_16x9'

  interface SlideDef {
    title: string
    bullets: string[]
  }
  const slides: SlideDef[] = []
  let current: SlideDef | null = null
  const ensure = (): SlideDef => {
    if (!current) {
      current = { title: '', bullets: [] }
      slides.push(current)
    }
    return current
  }

  const pushText = (text: string) => {
    const t = text.trim()
    if (t) ensure().bullets.push(t)
  }

  for (const token of marked.lexer(markdown) as Token[]) {
    if (token.type === 'heading' && (token as Tokens.Heading).depth <= 2) {
      current = { title: (token as Tokens.Heading).text, bullets: [] }
      slides.push(current)
    } else if (token.type === 'heading') {
      pushText((token as Tokens.Heading).text)
    } else if (token.type === 'paragraph') {
      pushText((token as Tokens.Paragraph).text)
    } else if (token.type === 'list') {
      for (const item of (token as Tokens.List).items) pushText(item.text)
    } else if (token.type === 'code') {
      pushText((token as Tokens.Code).text)
    }
  }

  if (slides.length === 0) slides.push({ title: defaultName, bullets: [] })

  for (const s of slides) {
    const slide = pptx.addSlide()
    if (s.title) {
      slide.addText(s.title, { x: 0.5, y: 0.35, w: 9, h: 0.8, fontSize: 28, bold: true, color: '2A2A2A' })
    }
    if (s.bullets.length > 0) {
      slide.addText(
        s.bullets.map((b) => ({ text: stripInlineMd(b), options: { bullet: true, breakLine: true } })),
        { x: 0.6, y: s.title ? 1.35 : 0.5, w: 8.8, h: 4.5, fontSize: 16, color: '363636', valign: 'top' }
      )
    }
  }

  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
}

const FORMAT_LABEL: Record<OfficeFormat, string> = {
  docx: 'Word Document',
  xlsx: 'Excel Workbook',
  pptx: 'PowerPoint Presentation'
}

/** Save-dialog wrapper used by the per-message export buttons. */
export async function exportMarkdownToOffice(
  win: BrowserWindow | null,
  format: OfficeFormat,
  markdown: string,
  defaultName: string
): Promise<string | null> {
  const filePath = await askSavePath(win, defaultName, format, FORMAT_LABEL[format])
  if (!filePath) return null
  writeFileSync(filePath, await buildOfficeBuffer(format, markdown, defaultName))
  return filePath
}

/**
 * The create_document chat tool lands here: ask the user where to save,
 * then build + write the file. Returns a message for the model plus the
 * saved path (null when the user cancelled) so chat.ts can trigger the
 * split-screen preview.
 */
export async function saveDocumentFromTool(
  win: BrowserWindow | null,
  format: OfficeFormat,
  markdown: string,
  filename: string
): Promise<{ message: string; filePath: string | null }> {
  const filePath = await askSavePath(win, filename, format, FORMAT_LABEL[format])
  if (!filePath) {
    return {
      message: 'The user cancelled the save dialog — the document was not saved. Do not retry unless asked.',
      filePath: null
    }
  }
  writeFileSync(filePath, await buildOfficeBuffer(format, markdown, filename))
  return { message: `Document created and saved to ${filePath}. Tell the user where it was saved.`, filePath }
}

/**
 * Self-contained HTML preview of a generated document (rendered markdown on a
 * white "page", with a header naming the saved file) for the artifact panel.
 */
export async function renderDocPreviewHtml(
  markdown: string,
  format: OfficeFormat,
  path: string
): Promise<string> {
  const body = await marked.parse(markdown)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#525659;font-family:Calibri,'Segoe UI',sans-serif}
  .bar{position:sticky;top:0;background:#2f3133;color:#ddd;font-size:12px;padding:7px 14px;
       white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .page{background:#fff;color:#222;max-width:760px;margin:18px auto;padding:56px 64px;
        min-height:600px;box-shadow:0 2px 14px rgba(0,0,0,.45);line-height:1.55;font-size:15px}
  .page table{border-collapse:collapse;width:100%;margin:12px 0}
  .page th,.page td{border:1px solid #999;padding:6px 10px;text-align:left}
  .page th{background:#f0f0f0}
  .page pre{background:#f5f5f5;padding:10px;overflow:auto}
  .page h1,.page h2,.page h3{color:#111}
  </style></head><body>
  <div class="bar">📄 Saved: ${esc(path)}</div>
  <div class="page">${body}</div>
  </body></html>`
}

/** Drop the most common inline markdown noise for slide text. */
function stripInlineMd(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

async function askSavePath(
  win: BrowserWindow | null,
  defaultName: string,
  ext: string,
  label: string
): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    title: `Save as ${label}`,
    defaultPath: sanitizeFilename(defaultName) + '.' + ext,
    filters: [{ name: label, extensions: [ext] }]
  })
  return canceled || !filePath ? null : filePath
}

function sanitizeFilename(name: string): string {
  return (
    name
      .replace(/[<>:"/\\|?*\n\r]+/g, ' ')
      .trim()
      .slice(0, 60) || 'orbit-export'
  )
}
