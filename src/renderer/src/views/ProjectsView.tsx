import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConversationMeta, ModelInfo, Project, ProjectMeta } from '../../../shared/types'
import { pickDefaultModel } from '../prefs'
import { ChatIcon, FolderIcon, PlusIcon } from './Icons'
import SectionLanding, { timeAgo } from './SectionLanding'

export default function ProjectsView({
  onOpenConversation
}: {
  onOpenConversation: (conversationId: string) => void
}) {
  const [metas, setMetas] = useState<ProjectMeta[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [models, setModels] = useState<ModelInfo[]>([])
  const [chats, setChats] = useState<ConversationMeta[]>([])
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setMetas(await window.api.projects.list())
  }, [])

  useEffect(() => {
    refresh()
    Promise.all([window.api.models.list(), window.api.ollama.detect()]).then(([m, o]) =>
      setModels([...m, ...o.models])
    )
  }, [refresh])

  // Load the conversations that belong to the selected project
  useEffect(() => {
    if (!project) {
      setChats([])
      return
    }
    let cancelled = false
    window.api.conversations.list().then((all) => {
      if (!cancelled) setChats(all.filter((c) => c.projectId === project.id))
    })
    return () => {
      cancelled = true
    }
  }, [project])

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    const p = await window.api.projects.create(name)
    setNewName('')
    setProject(p)
    refresh()
  }

  const select = async (id: string) => {
    setProject(await window.api.projects.get(id))
  }

  const remove = async (id: string) => {
    const name = metas.find((p) => p.id === id)?.name || 'this project'
    const ok = await window.api.confirm(
      `Delete project “${name}”?`,
      'This permanently removes the project, its instructions and attached files. This cannot be undone.'
    )
    if (!ok) return
    await window.api.projects.delete(id)
    if (project?.id === id) setProject(null)
    refresh()
  }

  const addFiles = async () => {
    if (!project) return
    setBusy(true)
    try {
      setProject(await window.api.projects.addFiles(project.id))
    } finally {
      setBusy(false)
    }
    refresh()
  }

  const removeFile = async (fileId: string) => {
    if (!project) return
    setProject(await window.api.projects.removeFile(project.id, fileId))
    refresh()
  }

  const saveInstructions = async (instructions: string) => {
    if (!project) return
    setProject(await window.api.projects.update(project.id, { instructions }))
  }

  const newChat = async () => {
    if (!project) return
    const m = pickDefaultModel(models)
    if (!m) return
    const conv = await window.api.conversations.create(m.providerId, m.modelId, project.id)
    onOpenConversation(conv.id)
  }

  return (
    <div className="projects">
      <div className="project-list">
        <div className="row">
          <input
            ref={nameRef}
            placeholder="New project name…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && create()}
          />
          <button onClick={create} disabled={!newName.trim()}>
            Create
          </button>
        </div>
        {metas.map((m) => (
          <div
            key={m.id}
            className={`chat-item ${project?.id === m.id ? 'active' : ''}`}
            onClick={() => select(m.id)}
          >
            <span className="chat-item-title">
              📁 {m.name}
              <span className="project-count"> · {m.fileCount} files</span>
            </span>
            <button
              className="ghost small chat-item-del"
              onClick={(e) => {
                e.stopPropagation()
                remove(m.id)
              }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {!project ? (
        <SectionLanding
          icon={<FolderIcon />}
          title="Your knowledge projects"
          subtitle="A project bundles instructions and files. Chats inside a project automatically get the instructions plus the most relevant file excerpts (RAG) — so the AI answers from your documents."
          stats={[
            { label: 'Projects', value: metas.length },
            { label: 'Files', value: metas.reduce((n, m) => n + m.fileCount, 0) },
            { label: 'Last active', value: metas.length ? timeAgo(Math.max(...metas.map((m) => m.updatedAt))) : '—' }
          ]}
          ctaLabel="New project"
          onCta={() => nameRef.current?.focus()}
          recent={metas.slice(0, 5).map((m) => ({
            id: m.id,
            title: m.name,
            subtitle: `${m.fileCount} file${m.fileCount === 1 ? '' : 's'}`
          }))}
          onOpen={select}
          steps={['Create a project', 'Add files & instructions', 'Chat with your docs']}
        />
      ) : (
        <div className="project-detail">
          <div className="project-head">
            <h1>{project.name}</h1>
            <button className="icon-btn" onClick={newChat} disabled={models.length === 0}>
              <PlusIcon /> New chat in project
            </button>
          </div>

          <h2>Chats</h2>
          {chats.length === 0 ? (
            <div className="card-sub">
              No chats yet. Use “New chat in project” — conversations you start here appear in this
              list.
            </div>
          ) : (
            <div className="project-chats">
              {chats.map((c) => (
                <div
                  key={c.id}
                  className="project-chat-row"
                  onClick={() => onOpenConversation(c.id)}
                  title="Open this chat"
                >
                  <ChatIcon />
                  <span className="project-chat-title">{c.title}</span>
                  <span className="project-chat-date">{formatDate(c.updatedAt)}</span>
                </div>
              ))}
            </div>
          )}

          <h2>Instructions</h2>
          <textarea
            className="project-instructions"
            placeholder="Instructions included in every chat of this project (e.g. 'You are helping with my thesis on X. Be precise, cite the attached papers.')"
            defaultValue={project.instructions}
            key={project.id}
            onBlur={(e) => saveInstructions(e.target.value)}
            rows={4}
          />

          <h2>Files</h2>
          <div className="project-files">
            {project.files.length === 0 && (
              <div className="card-sub">No files yet. Supported: txt, md, pdf, docx, csv, json, log.</div>
            )}
            {project.files.map((f) => (
              <div key={f.id} className="model-row">
                <span className="model-label">{f.name}</span>
                <span className="model-id">
                  {f.chunkCount} chunks · {f.embeddingModel ? `embedded (${f.embeddingModel})` : 'keyword search'}
                </span>
                <span className="model-ctx">{formatSize(f.size)}</span>
                <button className="ghost small" onClick={() => removeFile(f.id)}>
                  remove
                </button>
              </div>
            ))}
          </div>
          <button className="ghost" onClick={addFiles} disabled={busy}>
            {busy ? 'Ingesting… (chunking + embedding)' : '+ Attach files'}
          </button>
        </div>
      )}
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} KB`
  return `${bytes} B`
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
