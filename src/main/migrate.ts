import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { getConfig, updateConfig } from './settings'
import { OLLAMA_CLOUD_ID } from './registry'

/**
 * Shared one-time migration: a provider that used to be hand-added as a "custom
 * provider" (id custom-<timestamp>, matched by its base URL) is now a BUILT-IN
 * provider with a fixed id. Move the saved key, provider plan, custom models,
 * conversations, Cowork sessions and the model cache over, then drop the custom
 * provider so it doesn't show twice. Safe to run every start — no-op once done.
 */
function migrateCustomToBuiltin(urlNeedle: string, targetId: string): void {
  try {
    const cfg = getConfig()
    const legacy = cfg.customProviders.find((p) => (p.baseURL ?? '').includes(urlNeedle))
    if (!legacy) return
    const userData = app.getPath('userData')

    // saved API key (secrets.json values stay encrypted — moved as-is)
    const secretsPath = join(userData, 'secrets.json')
    if (existsSync(secretsPath)) {
      const secrets = JSON.parse(readFileSync(secretsPath, 'utf-8')) as Record<string, unknown>
      if (secrets[legacy.id] && !secrets[targetId]) {
        secrets[targetId] = secrets[legacy.id]
      }
      delete secrets[legacy.id]
      writeFileSync(secretsPath, JSON.stringify(secrets), 'utf-8')
    }

    // config: carry over the free/paid plan, re-home custom models, drop the
    // custom provider
    const plans = { ...cfg.providerPlans }
    if (plans[legacy.id] && !plans[targetId]) plans[targetId] = plans[legacy.id]
    delete plans[legacy.id]
    updateConfig({
      providerPlans: plans,
      customProviders: cfg.customProviders.filter((p) => p.id !== legacy.id),
      customModels: cfg.customModels.map((m) =>
        m.providerId === legacy.id ? { ...m, providerId: targetId } : m
      )
    })

    // conversations + cowork sessions keep working under the new provider id
    for (const dir of ['conversations', 'cowork']) {
      const full = join(userData, dir)
      if (!existsSync(full)) continue
      for (const file of readdirSync(full).filter((f) => f.endsWith('.json'))) {
        try {
          const path = join(full, file)
          const data = JSON.parse(readFileSync(path, 'utf-8')) as { providerId?: string }
          if (data.providerId === legacy.id) {
            data.providerId = targetId
            writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8')
          }
        } catch {
          // one bad file must not block the app
        }
      }
    }

    // model cache: DELETE the legacy entry (not rename) so the first fetch
    // under the new id runs the tier probe
    const cachePath = join(userData, 'models-cache.json')
    if (existsSync(cachePath)) {
      const cache = JSON.parse(readFileSync(cachePath, 'utf-8')) as Record<string, unknown>
      delete cache[legacy.id]
      writeFileSync(cachePath, JSON.stringify(cache), 'utf-8')
    }
  } catch {
    // migration is best-effort; the app must still boot
  }
}

/** v0.3.0: Ollama Cloud custom provider → built-in 'ollama-cloud'. */
export function migrateOllamaCloud(): void {
  migrateCustomToBuiltin('ollama.com', OLLAMA_CLOUD_ID)
}

/**
 * v0.9.3: Groq is now a built-in provider. If the user had added it by hand as
 * a custom OpenAI-compatible provider, fold that entry (key, plan, models,
 * chats) into the built-in 'groq' so they don't see two Groq cards.
 */
export function migrateGroq(): void {
  migrateCustomToBuiltin('api.groq.com', 'groq')
}
