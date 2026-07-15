// mammoth ships lib/index.d.ts but doesn't declare it in package.json "types",
// so TS can't find it — declare the minimal surface we use.
declare module 'mammoth' {
  export function extractRawText(input: { buffer: Buffer }): Promise<{ value: string }>
}

// html-to-docx ships no types
declare module 'html-to-docx' {
  function HTMLtoDOCX(
    html: string,
    headerHtml?: string | null,
    options?: Record<string, unknown>,
    footerHtml?: string | null
  ): Promise<ArrayBuffer | Buffer>
  export default HTMLtoDOCX
}
