import { useCallback, useEffect, useState } from 'react'
import type {
  McpServerConfig,
  McpServerStatus,
  ModelInfo,
  PromptTemplate,
  SkillInfo
} from '../../../shared/types'
import { FONT_OPTIONS, getStoredFont, setStoredFont } from '../font'
import { ACCENT_OPTIONS, getStoredAccent, setStoredAccent } from '../accent'
import { type Density, getStoredDensity, setStoredDensity } from '../density'
import { confirmDialog, alertDialog, promptPassword } from '../confirm'
import BenchmarksPanel from './BenchmarksPanel'
import {
  defaultClassifier,
  getAutopilotSettings,
  setAutopilotSettings,
  type AutopilotSettings
} from '../autopilot'

// Note: AI providers + models now have their own top-level "Providers" view
// (see ProvidersView.tsx) so this screen stays focused on app-level settings.
export default function SettingsView() {
  return (
    <div className="settings">
      <h1>Settings</h1>

      <h2>Appearance</h2>
      <AppearanceSection />

      <h2>Mathematics</h2>
      <MathFormatSection />

      <h2>Memory</h2>
      <MemorySection />

      <h2>Prompt templates</h2>
      <PromptsSection />

      <h2>Skills</h2>
      <SkillsSection />

      <h2>MCP servers</h2>
      <McpSection />

      <h2>Autopilot</h2>
      <div className="card">
        <div className="card-sub">
          Autopilot judges how hard each message is and routes easy ones to a fast/free model and
          hard ones to your best model. It is always on — pick “Autopilot” at the top of the model
          picker in any chat. By default a fast built-in rule decides difficulty for free.
        </div>
        <AutopilotOptions />
      </div>

      <h2>Personal benchmarks</h2>
      <div className="card">
        <div className="card-sub">
          Save your own test prompts and run them across models you pick. A judge scores each answer
          1–10 and shows a results table with speed and cost.
        </div>
        <BenchmarksPanel />
      </div>

      <h2>Data &amp; privacy</h2>
      <DataPrivacySection />
    </div>
  )
}

// Backup (encrypted export) / restore / permanent delete of ALL personal data.
function DataPrivacySection() {
  const [busy, setBusy] = useState<null | 'backup' | 'restore' | 'delete'>(null)

  const backup = async () => {
    const password = await promptPassword('Choose a password for this backup', {
      detail:
        'Your export is encrypted with this password. You will need the exact same password to restore it — there is no way to recover it if you forget it, so store it somewhere safe.',
      confirmLabel: 'Create backup'
    })
    if (!password) return
    setBusy('backup')
    try {
      const res = await window.api.data.backup(password)
      if (res.ok && res.path) {
        await alertDialog('Backup created', `Your encrypted backup was saved to:\n${res.path}`)
      } else if (res.error) {
        await alertDialog('Backup failed', res.error)
      }
    } finally {
      setBusy(null)
    }
  }

  const restore = async () => {
    const ok = await confirmDialog('Restore from a backup?', {
      detail:
        'This replaces your current chats, projects, skills, settings and API keys with the contents of the backup. Anything not in the backup is removed.',
      confirmLabel: 'Choose backup…',
      danger: false
    })
    if (!ok) return
    const password = await promptPassword('Enter the backup password', {
      confirmLabel: 'Restore'
    })
    if (!password) return
    setBusy('restore')
    try {
      const res = await window.api.data.restore(password)
      if (res.ok) {
        await alertDialog('Restore complete', 'Your data has been restored. Orbit will now reload.')
        location.reload()
      } else if (res.error) {
        await alertDialog('Restore failed', res.error)
      }
    } finally {
      setBusy(null)
    }
  }

  const deleteAll = async () => {
    const first = await confirmDialog('Delete ALL your Orbit data?', {
      detail:
        'This permanently removes every chat, project, folder, uploaded skill, saved prompt, app preference AND all your API keys from this computer. This CANNOT be undone. Consider making a backup first.',
      confirmLabel: 'Continue…'
    })
    if (!first) return
    const second = await confirmDialog('Are you absolutely sure?', {
      detail: 'There is no way to recover this data afterwards. This is your final confirmation.',
      confirmLabel: 'Delete everything'
    })
    if (!second) return
    setBusy('delete')
    try {
      await window.api.data.deleteAll()
      // Clear renderer-side prefs (theme, favourites, caches) too, then restart.
      try {
        localStorage.clear()
      } catch {
        /* ignore */
      }
      await alertDialog('All data deleted', 'Your Orbit data has been removed. Orbit will now reload.')
      location.reload()
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card">
      <div className="card-sub">
        Move Orbit to another computer, or wipe everything from this one. Backups are fully encrypted
        with a password you choose — keep it safe, as it cannot be recovered.
      </div>
      <div className="data-privacy-actions">
        <button className="ghost" onClick={backup} disabled={busy !== null}>
          {busy === 'backup' ? 'Working…' : '⬇ Back up my data (encrypted)'}
        </button>
        <button className="ghost" onClick={restore} disabled={busy !== null}>
          {busy === 'restore' ? 'Working…' : '⬆ Restore from a backup'}
        </button>
      </div>
      <div className="data-danger">
        <div className="data-danger-text">
          <strong>Delete all my data</strong>
          <span>
            Permanently erase every chat, project, skill, preference and API key from this computer.
            This cannot be undone.
          </span>
        </div>
        <button className="danger" onClick={deleteAll} disabled={busy !== null}>
          {busy === 'delete' ? 'Deleting…' : 'Delete everything'}
        </button>
      </div>
    </div>
  )
}

function AutopilotOptions() {
  const [models, setModels] = useState<ModelInfo[]>([])
  const [settings, setSettings] = useState(() => getAutopilotSettings())
  useEffect(() => {
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) =>
      setModels([...m, ...o.models])
    )
  }, [])
  const update = (patch: Partial<AutopilotSettings>): void => {
    const next = { ...settings, ...patch }
    setSettings(next)
    setAutopilotSettings(next)
  }
  const auto = defaultClassifier(models)
  return (
    <div className="autopilot-options">
      <label className="beta-toggle">
        <input
          type="checkbox"
          checked={settings.useClassifier}
          onChange={(e) => update({ useClassifier: e.target.checked })}
        />
        <span className="beta-toggle-label">
          Use a cheap model to help classify each message (1 extra call per message)
        </span>
      </label>
      <div className="beta-row-desc">
        Off by default — a fast built-in heuristic decides difficulty for free. Turn this on for
        smarter routing at the cost of one small extra call.
      </div>
      {settings.useClassifier && (
        <div className="row" style={{ marginTop: 6 }}>
          <label className="field-label">Classifier model</label>
          <select
            value={settings.classifierId}
            onChange={(e) => update({ classifierId: e.target.value })}
          >
            <option value="">Auto ({auto ? auto.label : 'cheapest available'})</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

function AppearanceSection() {
  const [font, setFont] = useState(() => getStoredFont())
  const [accent, setAccent] = useState(() => getStoredAccent())
  const [density, setDensity] = useState<Density>(() => getStoredDensity())

  // Whether the current accent matches one of the named presets (else it's a custom hex).
  const presetId = ACCENT_OPTIONS.find((a) => a.color === accent || (a.id === 'default' && accent === 'default'))?.id
  const customValue = /^#[0-9a-fA-F]{6}$/.test(accent) ? accent : '#7f92c4'

  const chooseAccent = (value: string) => {
    setAccent(value)
    setStoredAccent(value)
  }
  const chooseDensity = (d: Density) => {
    setDensity(d)
    setStoredDensity(d)
  }

  return (
    <div className="card">
      <div className="card-sub">Personalise the look. Changes apply instantly across the app.</div>

      {/* Accent colour */}
      <div className="row">
        <label className="field-label">Accent</label>
        <div className="accent-swatches">
          {ACCENT_OPTIONS.map((a) => {
            const selected = a.id === 'default' ? accent === 'default' : accent === a.color
            return (
              <button
                key={a.id}
                className={`accent-swatch${selected ? ' selected' : ''}${a.id === 'default' ? ' accent-default' : ''}`}
                title={a.label}
                aria-label={`Accent: ${a.label}`}
                style={a.color ? { background: a.color } : undefined}
                onClick={() => chooseAccent(a.id === 'default' ? 'default' : a.color!)}
              >
                {a.id === 'default' ? 'A' : ''}
              </button>
            )
          })}
          <label
            className={`accent-swatch accent-custom${!presetId ? ' selected' : ''}`}
            title="Custom colour"
            style={!presetId ? { background: customValue } : undefined}
          >
            <span className="accent-custom-plus">+</span>
            <input
              type="color"
              value={customValue}
              onChange={(e) => chooseAccent(e.target.value)}
            />
          </label>
        </div>
      </div>

      {/* Density */}
      <div className="row">
        <label className="field-label">Density</label>
        <div className="segmented">
          <button
            className={density === 'comfortable' ? 'on' : ''}
            onClick={() => chooseDensity('comfortable')}
          >
            Comfortable
          </button>
          <button
            className={density === 'compact' ? 'on' : ''}
            onClick={() => chooseDensity('compact')}
          >
            Compact
          </button>
        </div>
      </div>

      {/* Font */}
      <div className="row">
        <label className="field-label">Font</label>
        <select
          value={font}
          onChange={(e) => {
            setFont(e.target.value)
            setStoredFont(e.target.value)
          }}
        >
          {FONT_OPTIONS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="font-preview" style={{ fontFamily: FONT_OPTIONS.find((f) => f.id === font)?.stack }}>
          The quick brown fox jumps over the lazy dog.
        </span>
      </div>
    </div>
  )
}

function MathFormatSection() {
  const [format, setFormat] = useState<'latex' | 'unicode'>('latex')
  useEffect(() => {
    window.api.settings.getMathFormat().then(setFormat)
  }, [])
  const change = (f: 'latex' | 'unicode') => {
    setFormat(f)
    window.api.settings.setMathFormat(f)
  }
  return (
    <div className="card">
      <div className="card-sub">
        How models should write mathematics. <strong>LaTeX</strong> is rendered as beautiful
        equations; <strong>Unicode</strong> uses plain symbols (x², √, ∫, ≤) that are easy to copy.
        You can also just ask any model to switch during a chat.
      </div>
      <div className="row">
        <label className="field-label">Math format</label>
        <select value={format} onChange={(e) => change(e.target.value as 'latex' | 'unicode')}>
          <option value="latex">LaTeX (rendered equations) — default</option>
          <option value="unicode">Unicode (plain symbols)</option>
        </select>
      </div>
    </div>
  )
}

function MemorySection() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.api.memory.get().then(setText)
  }, [])

  const save = async () => {
    await window.api.memory.set(text)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="card">
      <div className="card-sub">
        Facts every chat remembers. The AI adds to this when you say “remember that…” — you can
        edit or delete anything here.
      </div>
      <textarea
        className="memory-editor"
        value={text}
        placeholder="Nothing remembered yet. Try telling any chat: “remember that I prefer short answers”."
        onChange={(e) => setText(e.target.value)}
        rows={6}
      />
      <div className="row">
        <div className="composer-spacer" />
        <button className="ghost danger" onClick={() => setText('')}>
          Clear
        </button>
        <button onClick={save}>{saved ? '✓ Saved' : 'Save'}</button>
      </div>
    </div>
  )
}

function PromptsSection() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const refresh = useCallback(async () => {
    setTemplates(await window.api.prompts.list())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const reset = () => {
    setEditingId(null)
    setTitle('')
    setBody('')
  }

  const save = async () => {
    if (!title.trim() || !body.trim()) return
    await window.api.prompts.save({ id: editingId ?? undefined, title: title.trim(), body: body.trim() })
    reset()
    refresh()
  }

  const edit = (t: PromptTemplate) => {
    setEditingId(t.id)
    setTitle(t.title)
    setBody(t.body)
  }

  const remove = async (id: string) => {
    await window.api.prompts.remove(id)
    if (editingId === id) reset()
    refresh()
  }

  return (
    <>
      <div className="card-sub">
        Reusable prompts. Saved templates appear under the “Templates” button in the chat box — click
        one to drop it into your message.
      </div>
      <div className="model-list">
        {templates.map((t) => (
          <div key={t.id} className="model-row">
            <span className="model-label">{t.title}</span>
            <span className="model-id">{t.body}</span>
            <button className="ghost small" onClick={() => edit(t)}>
              edit
            </button>
            <button className="ghost small danger" onClick={() => remove(t.id)}>
              delete
            </button>
          </div>
        ))}
        {templates.length === 0 && <div className="card-sub">No templates yet.</div>}
      </div>
      <div className="card form">
        <div className="card-head">
          <strong>{editingId ? 'Edit template' : 'Add template'}</strong>
        </div>
        <div className="row">
          <input
            placeholder="Title (e.g. Explain simply)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="row">
          <textarea
            className="memory-editor"
            placeholder="The prompt text to insert…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
          />
        </div>
        <div className="row">
          <button onClick={save} disabled={!title.trim() || !body.trim()}>
            {editingId ? 'Save changes' : 'Add template'}
          </button>
          {editingId && (
            <button className="ghost" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </>
  )
}

function SkillsSection() {
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; message: string } | null>(null)

  const refresh = useCallback(async () => {
    setSkills(await window.api.skills.list())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const toggle = async (s: SkillInfo) => {
    await window.api.skills.setEnabled(s.id, !s.enabled)
    refresh()
  }

  const remove = async (s: SkillInfo) => {
    const ok = await confirmDialog(`Remove skill “${s.name}”?`, {
      detail: 'This deletes the skill folder from Orbit. You can upload it again later.',
      confirmLabel: 'Remove skill'
    })
    if (!ok) return
    await window.api.skills.delete(s.id)
    refresh()
  }

  const upload = async () => {
    const result = await window.api.skills.upload()
    if (result) {
      setUploadMsg(result)
      refresh()
    }
  }

  return (
    <>
      <div className="model-list">
        {skills.map((s) => (
          <div key={s.id} className="model-row">
            <span className="model-label">{s.name}</span>
            <span className="model-id">{s.description}</span>
            <button className="ghost small" onClick={() => toggle(s)}>
              {s.enabled ? 'enabled ✓' : 'disabled'}
            </button>
            <button
              className="ghost small danger"
              title="Remove this skill from Orbit"
              onClick={() => remove(s)}
            >
              Remove
            </button>
          </div>
        ))}
        {skills.length === 0 && <div className="card-sub">No skills found.</div>}
      </div>
      <div className="row" style={{ marginTop: 0 }}>
        <button onClick={upload}>⬆ Upload skill</button>
        <button className="ghost" onClick={() => window.api.skills.openFolder()}>
          Open skills folder
        </button>
        <button className="ghost" onClick={refresh}>
          ↻ Reload
        </button>
      </div>
      {uploadMsg && (
        <div className={`status ${uploadMsg.ok ? 'ok' : 'err'}`}>{uploadMsg.message}</div>
      )}
      <div className="card-sub" style={{ marginTop: 8 }}>
        A skill is a folder containing a SKILL.md with <code>name:</code> and{' '}
        <code>description:</code> frontmatter. Enabled skills are offered to every model; the
        full instructions load automatically when a task matches.
      </div>
    </>
  )
}

function McpSection() {
  const [servers, setServers] = useState<McpServerStatus[]>([])
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    window.api.mcp.list().then(setServers)
  }, [])

  const add = async () => {
    if (!name.trim() || !target.trim()) return
    setBusy(true)
    const input: Omit<McpServerConfig, 'id'> = {
      name: name.trim(),
      transport,
      command: transport === 'stdio' ? target.trim() : undefined,
      url: transport === 'http' ? target.trim() : undefined,
      enabled: true
    }
    setServers(await window.api.mcp.add(input))
    setBusy(false)
    setName('')
    setTarget('')
    setOpen(false)
  }

  const remove = async (id: string) => setServers(await window.api.mcp.remove(id))
  const toggle = async (s: McpServerStatus) =>
    setServers(await window.api.mcp.setEnabled(s.id, !s.enabled))
  const reconnect = async () => {
    setBusy(true)
    setServers(await window.api.mcp.sync())
    setBusy(false)
  }

  return (
    <>
      <div className="cards">
        {servers.map((s) => (
          <div key={s.id} className="card">
            <div className="card-head">
              <strong>{s.name}</strong>
              <span className={`badge ${s.connected ? 'ok' : ''}`}>
                {!s.enabled
                  ? 'disabled'
                  : s.connected
                    ? `connected · ${s.toolNames.length} tools`
                    : (s.error ?? 'not connected')}
              </span>
            </div>
            <div className="card-sub">
              {s.transport === 'stdio' ? `stdio: ${s.command}` : `http: ${s.url}`}
              {s.connected && s.toolNames.length > 0 && (
                <div className="tool-names">{s.toolNames.join(', ')}</div>
              )}
            </div>
            <div className="row">
              <button onClick={() => toggle(s)}>{s.enabled ? 'Disable' : 'Enable'}</button>
              <button className="danger" onClick={() => remove(s.id)}>
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 0 }}>
        {!open && (
          <button className="ghost" onClick={() => setOpen(true)}>
            + Add MCP server
          </button>
        )}
        <button className="ghost" onClick={reconnect} disabled={busy}>
          {busy ? 'Connecting…' : '↻ Reconnect all'}
        </button>
      </div>
      {open && (
        <div className="card form">
          <div className="card-head">
            <strong>Add MCP server</strong>
          </div>
          <div className="row">
            <input placeholder="Name (e.g. filesystem)" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={transport} onChange={(e) => setTransport(e.target.value as 'stdio' | 'http')}>
              <option value="stdio">stdio (local command)</option>
              <option value="http">HTTP (remote URL)</option>
            </select>
          </div>
          <div className="row">
            <input
              placeholder={
                transport === 'stdio'
                  ? 'Command, e.g. npx -y @modelcontextprotocol/server-filesystem C:\\data'
                  : 'URL, e.g. https://example.com/mcp'
              }
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <div className="row">
            <button onClick={add} disabled={busy || !name.trim() || !target.trim()}>
              {busy ? 'Connecting…' : 'Add & connect'}
            </button>
            <button className="ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          <div className="card-sub">
            Tools from connected servers become available to every model in chat, with a
            per-call approval prompt.
          </div>
        </div>
      )}
    </>
  )
}
