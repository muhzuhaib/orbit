import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'

/**
 * Persistent memory: a single markdown file every chat can read and append to,
 * so facts the user asks to remember survive across conversations and restarts.
 */

function memoryPath(): string {
  return join(app.getPath('userData'), 'memory.md')
}

export function getMemory(): string {
  try {
    return existsSync(memoryPath()) ? readFileSync(memoryPath(), 'utf-8') : ''
  } catch {
    return ''
  }
}

export function setMemory(content: string): void {
  writeFileSync(memoryPath(), content, 'utf-8')
}

export function appendMemory(fact: string): void {
  const current = getMemory().trimEnd()
  setMemory(`${current ? current + '\n' : ''}- ${fact.trim()}\n`)
}
