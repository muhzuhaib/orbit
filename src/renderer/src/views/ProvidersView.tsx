import { useCallback, useEffect, useState } from 'react'
import { ProviderLogo, hasProviderLogo } from './ProviderLogos'
import type {
  CustomModelInput,
  CustomProviderInput,
  ModelInfo,
  OllamaStatus,
  ProviderInfo
} from '../../../shared/types'

// Providers + Models used to live inside Settings. They now have their own
// top-level nav item ("Providers") so Settings stays uncluttered — this is the
// place to connect your AI accounts (API keys) and manage the model list.
export default function ProvidersView() {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [models, setModels] = useState<ModelInfo[]>([])
  const [ollama, setOllama] = useState<OllamaStatus | null>(null)
  // true once the first models fetch has landed — gates the "key saved but no
  // usable models" warning so it can't flash while the list is still loading
  const [modelsLoaded, setModelsLoaded] = useState(false)

  const refresh = useCallback(async () => {
    const [p, m, o] = await Promise.all([
      window.api.providers.list(),
      window.api.models.list(),
      window.api.ollama.detect()
    ])
    setProviders(p)
    setModels(m)
    setOllama(o)
    setModelsLoaded(true)
  }, [])

  useEffect(() => {
    refresh()
    // re-pull when a background usability probe finishes, so the Models list
    // below visibly trims to what each key can actually use
    return window.api.models.onUpdated(() => void refresh())
  }, [refresh])

  const connected = providers.filter((p) => p.hasKey).length + (ollama?.running ? 1 : 0)

  return (
    <div className="settings providers">
      <div className="page-head-row">
        <h1>Providers</h1>
        <RefreshModelsButton onRefreshed={refresh} />
      </div>
      <p className="page-intro">
        Connect the AI services you want to use by pasting their API key. Add as many as you like —
        every model you unlock shows up in the picker inside a chat.
      </p>

      <h2>
        Provider keys
        <span className="providers-count">{connected} connected</span>
      </h2>
      <div className="cards">
        {providers.map((p) =>
          p.id === 'ollama' ? (
            <OllamaCard key={p.id} status={ollama} onChanged={refresh} />
          ) : (
            <ProviderCard
              key={p.id}
              provider={p}
              onChanged={refresh}
              usableModels={
                modelsLoaded ? models.filter((m) => m.providerId === p.id).length : undefined
              }
            />
          )
        )}
      </div>
      <AddProviderForm onAdded={refresh} />

      <h2>Models</h2>
      <ModelRefreshRow onRefreshed={refresh} />
      <ModelList providers={providers} models={models} ollama={ollama} onChanged={refresh} />
      <AddModelForm providers={providers} onAdded={refresh} />
    </div>
  )
}

function ProviderCard({
  provider,
  onChanged,
  usableModels
}: {
  provider: ProviderInfo
  onChanged: () => void
  /** how many of this provider's models are currently usable (undefined = still loading) */
  usableModels?: number
}) {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!key.trim()) return
    await window.api.providers.setKey(provider.id, key.trim())
    setKey('')
    setStatus(null)
    onChanged()
  }

  const test = async () => {
    setBusy(true)
    setStatus(await window.api.providers.test(provider.id))
    setBusy(false)
  }

  const removeKey = async () => {
    await window.api.providers.deleteKey(provider.id)
    setStatus(null)
    onChanged()
  }

  const removeProvider = async () => {
    await window.api.providers.removeCustom(provider.id)
    onChanged()
  }

  return (
    <div className={`card provider-card ${provider.hasKey ? 'has-key' : ''}`}>
      <div className="card-head">
        <span className="prov-head-left">
          {hasProviderLogo(provider.id) ? (
            <ProviderLogo id={provider.id} />
          ) : (
            <span className="prov-avatar" style={{ background: providerAccent(provider.id) }}>
              {provider.label.charAt(0).toUpperCase()}
            </span>
          )}
          <strong>{provider.label}</strong>
        </span>
        <span className={`badge ${provider.hasKey ? 'ok' : ''}`}>
          {provider.hasKey ? '● key saved' : 'no key'}
        </span>
      </div>
      {provider.baseURL && <div className="card-sub">{provider.baseURL}</div>}
      <div className="row">
        <input
          type="password"
          placeholder={provider.hasKey ? 'Replace API key…' : 'Paste API key…'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />
        <button onClick={save} disabled={!key.trim()}>
          Save
        </button>
        <button onClick={test} disabled={!provider.hasKey || busy}>
          {busy ? 'Testing…' : 'Test'}
        </button>
        {provider.hasKey && <button onClick={removeKey}>Clear</button>}
        {!provider.builtin && (
          <button className="danger" onClick={removeProvider}>
            Remove
          </button>
        )}
      </div>
      {status && <div className={`status ${status.ok ? 'ok' : 'err'}`}>{status.message}</div>}
      {!status && provider.hasKey && usableModels === 0 && (
        <div className="status err">
          A key is saved, but none of this provider&apos;s models currently work with it — the key
          may be invalid or expired, or the account has no credit. Its models are hidden from the
          picker until this is fixed. Press <strong>Test</strong> to see the exact error, or paste
          a new key.
        </div>
      )}
    </div>
  )
}

function OllamaCard({ status, onChanged }: { status: OllamaStatus | null; onChanged: () => void }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (status) setUrl(status.url)
  }, [status])

  const apply = async () => {
    setBusy(true)
    await window.api.ollama.setUrl(url.trim())
    setBusy(false)
    onChanged()
  }

  return (
    <div className={`card provider-card ${status?.running ? 'has-key' : ''}`}>
      <div className="card-head">
        <span className="prov-head-left">
          <ProviderLogo id="ollama" />
          <strong>Ollama (local)</strong>
        </span>
        <span className={`badge ${status?.running ? 'ok' : ''}`}>
          {status === null ? 'checking…' : status.running ? `● running · ${status.models.length} models` : 'not detected'}
        </span>
      </div>
      <div className="card-sub">Local models — no API key needed. Install from ollama.com.</div>
      <div className="row">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:11434" />
        <button onClick={apply} disabled={busy}>
          {busy ? 'Checking…' : 'Detect'}
        </button>
      </div>
    </div>
  )
}

function AddProviderForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<CustomProviderInput['kind']>('openai-compat')
  const [baseURL, setBaseURL] = useState('')

  const add = async () => {
    if (!label.trim()) return
    if (kind === 'openai-compat' && !baseURL.trim()) return
    await window.api.providers.addCustom({
      label: label.trim(),
      kind,
      baseURL: kind === 'openai-compat' ? baseURL.trim().replace(/\/$/, '') : undefined
    })
    setLabel('')
    setBaseURL('')
    setOpen(false)
    onAdded()
  }

  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        + Add custom provider
      </button>
    )
  }

  return (
    <div className="card form">
      <div className="card-head">
        <strong>Add custom provider</strong>
      </div>
      <div className="row">
        <input placeholder="Name (e.g. Groq, OpenRouter)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <select value={kind} onChange={(e) => setKind(e.target.value as CustomProviderInput['kind'])}>
          <option value="openai-compat">OpenAI-compatible API</option>
          <option value="anthropic">Anthropic protocol</option>
          <option value="openai">OpenAI protocol</option>
          <option value="google">Google protocol</option>
        </select>
      </div>
      {kind === 'openai-compat' && (
        <div className="row">
          <input
            placeholder="Base URL (e.g. https://api.groq.com/openai/v1)"
            value={baseURL}
            onChange={(e) => setBaseURL(e.target.value)}
          />
        </div>
      )}
      <div className="row">
        <button onClick={add}>Add</button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      <div className="card-sub">
        Works with Groq, Mistral, DeepSeek, OpenRouter, LM Studio — anything exposing an
        OpenAI-compatible endpoint. Add the API key on the provider card after creating it.
      </div>
    </div>
  )
}

function RefreshModelsButton({
  onRefreshed,
  small
}: {
  onRefreshed: () => void
  small?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const doRefresh = async () => {
    setBusy(true)
    try {
      await window.api.models.refresh()
      onRefreshed()
    } finally {
      setBusy(false)
    }
  }
  return (
    <button
      className={small ? 'ghost small' : 'refresh-models-btn'}
      onClick={doRefresh}
      disabled={busy}
      title="Re-fetch every provider's model list and re-check which models your keys can actually use"
    >
      {busy ? '↻ Checking…' : '↻ Re-check models'}
    </button>
  )
}

function ModelRefreshRow({ onRefreshed }: { onRefreshed: () => void }) {
  return (
    <div className="model-refresh-row">
      <span className="hint">
        Model lists are fetched live from each connected provider (and refreshed automatically),
        so new models appear and retired ones disappear on their own. Orbit also checks each model
        against your key and hides the ones your account can't actually use (e.g. paid-only models
        on a free key), so the picker only shows models that will work.
      </span>
      <RefreshModelsButton onRefreshed={onRefreshed} small />
    </div>
  )
}

function ModelList({
  providers,
  models,
  ollama,
  onChanged
}: {
  providers: ProviderInfo[]
  models: ModelInfo[]
  ollama: OllamaStatus | null
  onChanged: () => void
}) {
  const all = [...models, ...(ollama?.models ?? [])]
  const byProvider = providers
    .map((p) => ({ provider: p, models: all.filter((m) => m.providerId === p.id) }))
    .filter((g) => g.models.length > 0)

  const remove = async (m: ModelInfo) => {
    await window.api.models.removeCustom(m.providerId, m.modelId)
    onChanged()
  }

  return (
    <div className="model-list">
      {byProvider.map(({ provider, models: group }) => (
        <div key={provider.id} className="model-group">
          <div className="model-group-title">{provider.label}</div>
          {group.map((m) => (
            <div key={m.id} className="model-row">
              <span className="model-label">{m.label}</span>
              <span className="model-id">{m.modelId}</span>
              <span className="model-ctx">{formatContext(m.contextWindow)} ctx</span>
              {!m.builtin && m.providerId !== 'ollama' && (
                <button className="ghost small" onClick={() => remove(m)}>
                  remove
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function AddModelForm({ providers, onAdded }: { providers: ProviderInfo[]; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [label, setLabel] = useState('')
  const [contextWindow, setContextWindow] = useState('')

  const selectable = providers.filter((p) => p.id !== 'ollama')

  const add = async () => {
    if (!providerId || !modelId.trim()) return
    const input: CustomModelInput = {
      providerId,
      modelId: modelId.trim(),
      label: label.trim() || undefined,
      contextWindow: contextWindow ? parseInt(contextWindow, 10) : undefined
    }
    await window.api.models.addCustom(input)
    setModelId('')
    setLabel('')
    setContextWindow('')
    setOpen(false)
    onAdded()
  }

  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        + Add custom model
      </button>
    )
  }

  return (
    <div className="card form">
      <div className="card-head">
        <strong>Add custom model</strong>
      </div>
      <div className="row">
        <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
          <option value="">Select provider…</option>
          {selectable.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input placeholder="Model ID (e.g. llama-3.3-70b-versatile)" value={modelId} onChange={(e) => setModelId(e.target.value)} />
      </div>
      <div className="row">
        <input placeholder="Display name (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input
          placeholder="Context window (tokens, default 32768)"
          value={contextWindow}
          onChange={(e) => setContextWindow(e.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div className="row">
        <button onClick={add} disabled={!providerId || !modelId.trim()}>
          Add
        </button>
        <button className="ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

// A muted brand-ish colour per provider, used for the little avatar tile so the
// list has visual variety without shouting.
function providerAccent(id: string): string {
  const map: Record<string, string> = {
    anthropic: '#c07a55',
    openai: '#10a37f',
    google: '#4a7fe0',
    deepseek: '#4d6bfe',
    qwen: '#7a5cff',
    glm: '#2b8a86',
    kimi: '#8a5cff',
    groq: '#f55036',
    ollama: '#8a8a92',
    'ollama-cloud': '#6a8aa8'
  }
  return map[id] ?? '#7f92c4'
}
