import { app, safeStorage } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type {
  CustomModelInput,
  CustomProviderInput,
  Folder,
  McpServerConfig,
  PromptTemplate
} from '../shared/types'

export interface StoredProvider extends CustomProviderInput {
  id: string
}

export interface StoredModel {
  providerId: string
  modelId: string
  label: string
  contextWindow: number
}

interface ConfigFile {
  customProviders: StoredProvider[]
  customModels: StoredModel[]
  ollamaUrl: string
  mcpServers: McpServerConfig[]
  disabledSkills: string[]
  promptTemplates: PromptTemplate[]
  /** folders for organising chats */
  folders: Folder[]
  /** providerId → subscription tier ('free' hides paid-only models) */
  providerPlans: Record<string, 'free' | 'paid'>
  /** how models should format maths: LaTeX (rendered) or plain Unicode. Default 'latex'. */
  mathFormat: 'latex' | 'unicode'
}

const DEFAULTS: ConfigFile = {
  customProviders: [],
  customModels: [],
  ollamaUrl: 'http://localhost:11434',
  mcpServers: [],
  disabledSkills: [],
  promptTemplates: [],
  folders: [],
  providerPlans: {},
  mathFormat: 'latex'
}

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function readJson<T>(path: string, fallback: T): T {
  try {
    if (!existsSync(path)) return fallback
    return { ...fallback, ...JSON.parse(readFileSync(path, 'utf-8')) }
  } catch {
    return fallback
  }
}

export function getConfig(): ConfigFile {
  return readJson(configPath(), DEFAULTS)
}

export function updateConfig(patch: Partial<ConfigFile>): ConfigFile {
  const next = { ...getConfig(), ...patch }
  writeFileSync(configPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function addCustomProvider(input: CustomProviderInput): StoredProvider {
  const provider: StoredProvider = { ...input, id: `custom-${Date.now()}` }
  updateConfig({ customProviders: [...getConfig().customProviders, provider] })
  return provider
}

export function removeCustomProvider(id: string): void {
  const cfg = getConfig()
  updateConfig({
    customProviders: cfg.customProviders.filter((p) => p.id !== id),
    customModels: cfg.customModels.filter((m) => m.providerId !== id)
  })
  deleteKey(id)
}

export function addCustomModel(input: CustomModelInput): StoredModel {
  const model: StoredModel = {
    providerId: input.providerId,
    modelId: input.modelId,
    label: input.label || input.modelId,
    contextWindow: input.contextWindow || 32768
  }
  const rest = getConfig().customModels.filter(
    (m) => !(m.providerId === model.providerId && m.modelId === model.modelId)
  )
  updateConfig({ customModels: [...rest, model] })
  return model
}

export function removeCustomModel(providerId: string, modelId: string): void {
  updateConfig({
    customModels: getConfig().customModels.filter(
      (m) => !(m.providerId === providerId && m.modelId === modelId)
    )
  })
}

export function addMcpServer(input: Omit<McpServerConfig, 'id'>): McpServerConfig {
  const server: McpServerConfig = { ...input, id: `mcp-${Date.now()}` }
  updateConfig({ mcpServers: [...getConfig().mcpServers, server] })
  return server
}

export function removeMcpServer(id: string): void {
  updateConfig({ mcpServers: getConfig().mcpServers.filter((s) => s.id !== id) })
}

export function setMcpServerEnabled(id: string, enabled: boolean): void {
  updateConfig({
    mcpServers: getConfig().mcpServers.map((s) => (s.id === id ? { ...s, enabled } : s))
  })
}

// --- Prompt templates (reusable prompts) ---

export function listPromptTemplates(): PromptTemplate[] {
  return getConfig().promptTemplates
}

export function savePromptTemplate(input: { id?: string; title: string; body: string }): PromptTemplate {
  const templates = getConfig().promptTemplates
  if (input.id) {
    const updated = templates.map((t) =>
      t.id === input.id ? { ...t, title: input.title, body: input.body } : t
    )
    updateConfig({ promptTemplates: updated })
    return updated.find((t) => t.id === input.id)!
  }
  const template: PromptTemplate = { id: `p${Date.now().toString(36)}`, title: input.title, body: input.body }
  updateConfig({ promptTemplates: [...templates, template] })
  return template
}

export function removePromptTemplate(id: string): void {
  updateConfig({ promptTemplates: getConfig().promptTemplates.filter((t) => t.id !== id) })
}

// --- Folders (organise chats) ---

export function listFolders(): Folder[] {
  return getConfig().folders
}

export function createFolder(name: string): Folder {
  const folder: Folder = { id: `f${Date.now().toString(36)}`, name: name.trim() || 'New folder' }
  updateConfig({ folders: [...getConfig().folders, folder] })
  return folder
}

export function renameFolder(id: string, name: string): Folder[] {
  const folders = getConfig().folders.map((f) => (f.id === id ? { ...f, name: name.trim() || f.name } : f))
  updateConfig({ folders })
  return folders
}

export function deleteFolder(id: string): Folder[] {
  const folders = getConfig().folders.filter((f) => f.id !== id)
  updateConfig({ folders })
  return folders
}

// --- Provider subscription plan (free vs paid) ---

export function setProviderPlan(providerId: string, plan: 'free' | 'paid'): void {
  updateConfig({ providerPlans: { ...getConfig().providerPlans, [providerId]: plan } })
}

export function getProviderPlan(providerId: string): 'free' | 'paid' {
  return getConfig().providerPlans[providerId] ?? 'paid'
}

// --- Maths formatting (LaTeX rendered vs plain Unicode) ---

export function getMathFormat(): 'latex' | 'unicode' {
  return getConfig().mathFormat ?? 'latex'
}

export function setMathFormat(format: 'latex' | 'unicode'): void {
  updateConfig({ mathFormat: format })
}

// --- API keys (encrypted at rest via Electron safeStorage / Windows DPAPI) ---

type SecretsFile = Record<string, { encrypted: boolean; value: string }>

function readSecrets(): SecretsFile {
  return readJson(secretsPath(), {})
}

function writeSecrets(secrets: SecretsFile): void {
  writeFileSync(secretsPath(), JSON.stringify(secrets), 'utf-8')
}

export function setKey(providerId: string, key: string): void {
  const secrets = readSecrets()
  if (safeStorage.isEncryptionAvailable()) {
    secrets[providerId] = {
      encrypted: true,
      value: safeStorage.encryptString(key).toString('base64')
    }
  } else {
    secrets[providerId] = { encrypted: false, value: Buffer.from(key).toString('base64') }
  }
  writeSecrets(secrets)
}

export function getKey(providerId: string): string | null {
  const entry = readSecrets()[providerId]
  if (!entry) return null
  try {
    return entry.encrypted
      ? safeStorage.decryptString(Buffer.from(entry.value, 'base64'))
      : Buffer.from(entry.value, 'base64').toString('utf-8')
  } catch {
    return null
  }
}

export function hasKey(providerId: string): boolean {
  return readSecrets()[providerId] !== undefined
}

export function deleteKey(providerId: string): void {
  const secrets = readSecrets()
  delete secrets[providerId]
  writeSecrets(secrets)
}
