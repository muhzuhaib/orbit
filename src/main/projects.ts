import { app } from 'electron'
import { basename, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import type { Project, ProjectChunk, ProjectFile, ProjectMeta } from '../shared/types'
import { chunkText, cosineSimilarity, keywordScore } from '../shared/rag'
import { embedderById, resolveEmbedder } from './embeddings'

/**
 * Storage layout (userData/projects/):
 *   <projectId>.json          — Project (metadata + file list, no chunk bodies)
 *   <projectId>.chunks.json   — Record<fileId, ProjectChunk[]> (text + embeddings)
 * Chunks are split out so listing projects stays cheap.
 */

function dir(): string {
  const d = join(app.getPath('userData'), 'projects')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

const projPath = (id: string) => join(dir(), `${id}.json`)
const chunksPath = (id: string) => join(dir(), `${id}.chunks.json`)

function save(p: Project): Project {
  p.updatedAt = Date.now()
  writeFileSync(projPath(p.id), JSON.stringify(p, null, 2), 'utf-8')
  return p
}

function readChunks(projectId: string): Record<string, ProjectChunk[]> {
  try {
    return JSON.parse(readFileSync(chunksPath(projectId), 'utf-8'))
  } catch {
    return {}
  }
}

function writeChunks(projectId: string, chunks: Record<string, ProjectChunk[]>): void {
  writeFileSync(chunksPath(projectId), JSON.stringify(chunks), 'utf-8')
}

export function listProjects(): ProjectMeta[] {
  const metas: ProjectMeta[] = []
  for (const file of readdirSync(dir())) {
    if (!file.endsWith('.json') || file.endsWith('.chunks.json')) continue
    try {
      const p = JSON.parse(readFileSync(join(dir(), file), 'utf-8')) as Project
      metas.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, fileCount: p.files.length })
    } catch {
      // skip corrupt entries
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getProject(id: string): Project {
  return JSON.parse(readFileSync(projPath(id), 'utf-8')) as Project
}

export function createProject(name: string): Project {
  const now = Date.now()
  const p: Project = {
    id: `p${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    name,
    instructions: '',
    createdAt: now,
    updatedAt: now,
    files: []
  }
  return save(p)
}

export function deleteProject(id: string): void {
  rmSync(projPath(id), { force: true })
  rmSync(chunksPath(id), { force: true })
}

export function updateProject(
  id: string,
  patch: Partial<Pick<Project, 'name' | 'instructions'>>
): Project {
  return save({ ...getProject(id), ...patch })
}

export function removeFile(projectId: string, fileId: string): Project {
  const p = getProject(projectId)
  p.files = p.files.filter((f) => f.id !== fileId)
  const chunks = readChunks(projectId)
  delete chunks[fileId]
  writeChunks(projectId, chunks)
  return save(p)
}

// ---------- Ingestion ----------

const SUPPORTED = ['.txt', '.md', '.markdown', '.pdf', '.docx', '.json', '.csv', '.log', '.xlsx', '.xls', '.pptx']

export async function ingestFiles(projectId: string, filePaths: string[]): Promise<Project> {
  const p = getProject(projectId)
  const allChunks = readChunks(projectId)
  const embedder = await resolveEmbedder()

  for (const filePath of filePaths) {
    const ext = extname(filePath).toLowerCase()
    if (!SUPPORTED.includes(ext)) continue

    const text = await extractText(filePath, ext)
    if (!text.trim()) continue

    const pieces = chunkText(text)
    let embeddings: number[][] | undefined
    if (embedder) {
      try {
        embeddings = await embedder.embed(pieces)
      } catch {
        embeddings = undefined // fall back to keyword retrieval for this file
      }
    }

    const file: ProjectFile = {
      id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      name: basename(filePath),
      size: statSync(filePath).size,
      addedAt: Date.now(),
      chunkCount: pieces.length,
      embeddingModel: embeddings ? embedder!.id : undefined
    }
    allChunks[file.id] = pieces.map((t, i) => ({ text: t, embedding: embeddings?.[i] }))
    // replace an existing file with the same name
    const existing = p.files.find((f) => f.name === file.name)
    if (existing) {
      delete allChunks[existing.id]
      p.files = p.files.filter((f) => f.id !== existing.id)
    }
    p.files.push(file)
  }

  writeChunks(projectId, allChunks)
  return save(p)
}

export async function extractText(filePath: string, ext: string): Promise<string> {
  const buffer = readFileSync(filePath)
  if (ext === '.xlsx' || ext === '.xls') {
    const { extractXlsx } = await import('./office')
    return extractXlsx(buffer)
  }
  if (ext === '.pptx') {
    const { extractPptx } = await import('./office')
    return extractPptx(buffer)
  }
  if (ext === '.pdf') {
    // pdf-parse v2 API: class with getText()
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    try {
      return (await parser.getText()).text
    } finally {
      await parser.destroy()
    }
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    return (await mammoth.extractRawText({ buffer })).value
  }
  return buffer.toString('utf-8')
}

// ---------- Retrieval ----------

export interface RetrievedChunk {
  fileName: string
  text: string
  score: number
}

export async function retrieve(projectId: string, query: string, k = 6): Promise<RetrievedChunk[]> {
  const p = getProject(projectId)
  if (p.files.length === 0) return []
  const allChunks = readChunks(projectId)

  // Use vector search when every embedded file shares one embedding space
  const embeddingModels = new Set(p.files.map((f) => f.embeddingModel).filter(Boolean) as string[])
  let queryEmbedding: number[] | null = null
  if (embeddingModels.size === 1 && query.trim()) {
    const embedder = await embedderById([...embeddingModels][0])
    if (embedder) {
      try {
        queryEmbedding = (await embedder.embed([query]))[0]
      } catch {
        queryEmbedding = null
      }
    }
  }

  const scored: RetrievedChunk[] = []
  for (const file of p.files) {
    for (const chunk of allChunks[file.id] ?? []) {
      const score =
        queryEmbedding && chunk.embedding
          ? cosineSimilarity(queryEmbedding, chunk.embedding)
          : keywordScore(query, chunk.text)
      scored.push({ fileName: file.name, text: chunk.text, score })
    }
  }
  scored.sort((a, b) => b.score - a.score)

  // If nothing matches at all (e.g. empty query), still return leading chunks as context
  const top = scored.slice(0, k)
  return top.some((c) => c.score > 0) ? top.filter((c) => c.score > 0) : top
}
