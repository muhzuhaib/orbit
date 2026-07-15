import { app, shell } from 'electron'
import { basename, dirname, extname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs'
import type { SkillInfo } from '../shared/types'
import { getConfig, updateConfig } from './settings'

/**
 * Skill format (Anthropic convention): userData/skills/<folder>/SKILL.md
 * with YAML frontmatter `name:` and `description:` followed by the skill body.
 */

function dir(): string {
  const d = join(app.getPath('userData'), 'skills')
  if (!existsSync(d)) {
    mkdirSync(d, { recursive: true })
    createExampleSkill(d)
  }
  return d
}

export function listSkills(): SkillInfo[] {
  const disabled = new Set(getConfig().disabledSkills ?? [])
  const skills: SkillInfo[] = []
  for (const entry of readdirSync(dir())) {
    const skillPath = join(dir(), entry, 'SKILL.md')
    try {
      if (!statSync(join(dir(), entry)).isDirectory() || !existsSync(skillPath)) continue
      const { meta } = parseFrontmatter(readFileSync(skillPath, 'utf-8'))
      skills.push({
        id: entry,
        name: meta.name || entry,
        description: meta.description || '',
        enabled: !disabled.has(entry)
      })
    } catch {
      // skip malformed skills
    }
  }
  return skills
}

export function getSkillBody(id: string): string {
  // guard against path traversal in the id
  if (/[\\/]|\.\./.test(id)) throw new Error('Invalid skill id')
  const raw = readFileSync(join(dir(), id, 'SKILL.md'), 'utf-8')
  return parseFrontmatter(raw).body
}

export function setSkillEnabled(id: string, enabled: boolean): void {
  const disabled = new Set(getConfig().disabledSkills ?? [])
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  updateConfig({ disabledSkills: [...disabled] })
}

export function openSkillsFolder(): void {
  shell.openPath(dir())
}

/**
 * Permanently remove a skill folder. Also drops it from the disabled-set so a
 * later skill re-imported under the same id starts enabled.
 */
export function deleteSkill(id: string): void {
  if (/[\\/]|\.\./.test(id)) throw new Error('Invalid skill id')
  rmSync(join(dir(), id), { recursive: true, force: true })
  const disabled = new Set(getConfig().disabledSkills ?? [])
  if (disabled.delete(id)) updateConfig({ disabledSkills: [...disabled] })
}

export function enabledSkills(): SkillInfo[] {
  return listSkills().filter((s) => s.enabled)
}

/**
 * Import a skill from a .zip (folder with SKILL.md, like claude.ai skill uploads)
 * or a bare .md file (becomes <filename>/SKILL.md).
 */
export async function importSkill(filePath: string): Promise<{ ok: boolean; message: string }> {
  const ext = extname(filePath).toLowerCase()

  if (ext === '.md') {
    const id = sanitizeId(basename(filePath, ext))
    const dest = join(dir(), id)
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'SKILL.md'), readFileSync(filePath, 'utf-8'), 'utf-8')
    return validateImported(id)
  }

  if (ext === '.zip') {
    const { default: JSZip } = await import('jszip')
    const zip = await JSZip.loadAsync(readFileSync(filePath))
    // find the shallowest SKILL.md — its directory is the skill root inside the zip
    const skillEntries = Object.keys(zip.files).filter(
      (n) => !zip.files[n].dir && basename(n).toLowerCase() === 'skill.md'
    )
    if (skillEntries.length === 0) {
      return { ok: false, message: 'The zip does not contain a SKILL.md file.' }
    }
    const skillMd = skillEntries.sort((a, b) => a.split('/').length - b.split('/').length)[0]
    const rootPrefix = skillMd.includes('/') ? skillMd.slice(0, skillMd.lastIndexOf('/') + 1) : ''
    const id = sanitizeId(
      rootPrefix ? rootPrefix.split('/').filter(Boolean).pop()! : basename(filePath, ext)
    )
    const dest = join(dir(), id)
    rmSync(dest, { recursive: true, force: true })

    for (const [name, entry] of Object.entries(zip.files)) {
      if (entry.dir || !name.startsWith(rootPrefix)) continue
      const rel = name.slice(rootPrefix.length)
      if (!rel || rel.includes('..')) continue
      const target = join(dest, rel)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, await entry.async('nodebuffer'))
    }
    return validateImported(id)
  }

  return { ok: false, message: 'Unsupported file type — upload a .zip or a .md file.' }
}

function validateImported(id: string): { ok: boolean; message: string } {
  try {
    const { meta } = parseFrontmatter(readFileSync(join(dir(), id, 'SKILL.md'), 'utf-8'))
    if (!meta.name || !meta.description) {
      return {
        ok: true,
        message: `Skill "${id}" imported, but its SKILL.md is missing name/description frontmatter — it will still work, using the folder name.`
      }
    }
    return { ok: true, message: `Skill "${meta.name}" imported.` }
  } catch {
    return { ok: false, message: 'Import failed — SKILL.md could not be read after extraction.' }
  }
}

function sanitizeId(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'skill'
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {}
  if (!content.startsWith('---')) return { meta, body: content }
  const end = content.indexOf('\n---', 3)
  if (end === -1) return { meta, body: content }
  const header = content.slice(3, end)
  for (const line of header.split('\n')) {
    const m = line.match(/^([A-Za-z_-]+):\s*(.*)$/)
    if (m) meta[m[1].toLowerCase()] = m[2].trim()
  }
  return { meta, body: content.slice(end + 4).replace(/^-*\s*/, '').trimStart() }
}

function createExampleSkill(skillsDir: string): void {
  const exampleDir = join(skillsDir, 'meeting-notes')
  mkdirSync(exampleDir, { recursive: true })
  writeFileSync(
    join(exampleDir, 'SKILL.md'),
    `---
name: Meeting Notes
description: Structure meeting notes with attendees, agenda, decisions, and action items. Use when the user asks to write, format, or clean up meeting notes or minutes.
---

# Meeting Notes Skill

When producing meeting notes, always use this structure:

## <Meeting title> — <date>

**Attendees:** comma-separated list

**Agenda:**
1. numbered agenda points

**Discussion:** short paragraphs per topic

**Decisions:**
- one bullet per decision, bolding the decision itself

**Action items:**

| Owner | Action | Due |
|-------|--------|-----|

Keep the tone neutral and factual. If information for a section is missing, include the
section anyway with "_(none recorded)_" so the reader knows it wasn't forgotten.
`,
    'utf-8'
  )
}
