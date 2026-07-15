import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  BenchmarkData,
  BenchmarkPrompt,
  BenchmarkRun,
  BenchmarkRunInput,
  ChatAttachment,
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  CompareChunkEvent,
  CompareColumnInput,
  CompareDoneEvent,
  CompareErrorEvent,
  CouncilAnswerChunkEvent,
  CouncilAnswerDoneEvent,
  CouncilDoneEvent,
  CouncilErrorEvent,
  CouncilRunInput,
  CouncilStatusEvent,
  CouncilVerdictChunkEvent,
  Conversation,
  ConversationMeta,
  ConversationSearchHit,
  Folder,
  CoworkEventPayload,
  CoworkSession,
  CoworkSessionMeta,
  CoworkToolRequestEvent,
  CustomModelInput,
  CustomProviderInput,
  DocumentPreviewEvent,
  McpServerConfig,
  McpServerStatus,
  ModelInfo,
  OllamaStatus,
  Project,
  ProjectMeta,
  PromptTemplate,
  ProviderInfo,
  SkillInfo,
  VerifyInput,
  VerifyReport,
  SwarmEventPayload,
  SwarmSession,
  SwarmSessionMeta,
  StudioEventPayload,
  StudioSession,
  StudioSessionMeta,
  ForgeEventPayload,
  ForgeSession,
  ForgeSessionMeta,
  ForgeToolRequestEvent,
  TestResult,
  ToolRequestEvent,
  UpdateStatus
} from '../shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Single bridge object. Every main-process capability the UI needs gets added here
// and mirrored in src/renderer/src/env.d.ts.
const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  /** Recolour the native title-bar overlay to match the current theme. */
  setTitlebarTheme: (dark: boolean): Promise<void> =>
    ipcRenderer.invoke('window:titlebar', dark),
  confirm: (message: string, detail?: string): Promise<boolean> =>
    ipcRenderer.invoke('ui:confirm', message, detail),

  providers: {
    list: (): Promise<ProviderInfo[]> => ipcRenderer.invoke('providers:list'),
    setKey: (id: string, key: string): Promise<void> =>
      ipcRenderer.invoke('providers:set-key', id, key),
    deleteKey: (id: string): Promise<void> => ipcRenderer.invoke('providers:delete-key', id),
    test: (id: string): Promise<TestResult> => ipcRenderer.invoke('providers:test', id),
    addCustom: (input: CustomProviderInput): Promise<ProviderInfo> =>
      ipcRenderer.invoke('providers:add-custom', input),
    removeCustom: (id: string): Promise<void> => ipcRenderer.invoke('providers:remove-custom', id),
    setPlan: (id: string, plan: 'free' | 'paid'): Promise<void> =>
      ipcRenderer.invoke('providers:set-plan', id, plan)
  },

  settings: {
    getMathFormat: (): Promise<'latex' | 'unicode'> =>
      ipcRenderer.invoke('settings:get-math-format'),
    setMathFormat: (format: 'latex' | 'unicode'): Promise<void> =>
      ipcRenderer.invoke('settings:set-math-format', format)
  },

  models: {
    list: (): Promise<ModelInfo[]> => ipcRenderer.invoke('models:list'),
    refresh: (): Promise<ModelInfo[]> => ipcRenderer.invoke('models:refresh'),
    /** fired after a background usability probe finishes — re-pull the list */
    onUpdated: (cb: () => void): (() => void) => subscribe('models:updated', cb),
    addCustom: (input: CustomModelInput): Promise<ModelInfo> =>
      ipcRenderer.invoke('models:add-custom', input),
    removeCustom: (providerId: string, modelId: string): Promise<void> =>
      ipcRenderer.invoke('models:remove-custom', providerId, modelId)
  },

  ollama: {
    detect: (): Promise<OllamaStatus> => ipcRenderer.invoke('ollama:detect'),
    setUrl: (url: string): Promise<OllamaStatus> => ipcRenderer.invoke('ollama:set-url', url)
  },

  updates: {
    onStatus: (cb: (payload: UpdateStatus) => void): (() => void) => subscribe('update:status', cb),
    restart: (): Promise<void> => ipcRenderer.invoke('update:restart')
  },

  conversations: {
    list: (): Promise<ConversationMeta[]> => ipcRenderer.invoke('conversations:list'),
    search: (query: string): Promise<ConversationSearchHit[]> =>
      ipcRenderer.invoke('conversations:search', query),
    get: (id: string): Promise<Conversation> => ipcRenderer.invoke('conversations:get', id),
    create: (providerId: string, modelId: string, projectId?: string): Promise<Conversation> =>
      ipcRenderer.invoke('conversations:create', providerId, modelId, projectId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('conversations:delete', id),
    deleteMany: (ids: string[]): Promise<void> =>
      ipcRenderer.invoke('conversations:delete-many', ids),
    deleteAll: (): Promise<number> => ipcRenderer.invoke('conversations:delete-all'),
    update: (
      id: string,
      patch: Partial<
        Pick<
          Conversation,
          | 'title'
          | 'providerId'
          | 'modelId'
          | 'systemPrompt'
          | 'thinking'
          | 'effort'
          | 'webSearch'
          | 'autopilot'
          | 'pinned'
          | 'folderId'
        >
      >
    ): Promise<Conversation> => ipcRenderer.invoke('conversations:update', id, patch)
  },

  folders: {
    list: (): Promise<Folder[]> => ipcRenderer.invoke('folders:list'),
    create: (name: string): Promise<Folder> => ipcRenderer.invoke('folders:create', name),
    rename: (id: string, name: string): Promise<Folder[]> =>
      ipcRenderer.invoke('folders:rename', id, name),
    delete: (id: string): Promise<Folder[]> => ipcRenderer.invoke('folders:delete', id)
  },

  memory: {
    get: (): Promise<string> => ipcRenderer.invoke('memory:get'),
    set: (content: string): Promise<void> => ipcRenderer.invoke('memory:set', content)
  },

  projects: {
    list: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('projects:list'),
    get: (id: string): Promise<Project> => ipcRenderer.invoke('projects:get', id),
    create: (name: string): Promise<Project> => ipcRenderer.invoke('projects:create', name),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('projects:delete', id),
    update: (id: string, patch: Partial<Pick<Project, 'name' | 'instructions'>>): Promise<Project> =>
      ipcRenderer.invoke('projects:update', id, patch),
    addFiles: (id: string): Promise<Project> => ipcRenderer.invoke('projects:add-files', id),
    removeFile: (projectId: string, fileId: string): Promise<Project> =>
      ipcRenderer.invoke('projects:remove-file', projectId, fileId)
  },

  chat: {
    send: (
      conversationId: string,
      text: string,
      attachments?: ChatAttachment[],
      model?: { providerId: string; modelId: string }
    ): Promise<void> => ipcRenderer.invoke('chat:send', conversationId, text, attachments, model),
    classify: (
      providerId: string,
      modelId: string,
      text: string
    ): Promise<'easy' | 'medium' | 'hard' | null> =>
      ipcRenderer.invoke('chat:classify', providerId, modelId, text),
    regenerate: (
      conversationId: string,
      model?: { providerId: string; modelId: string }
    ): Promise<void> => ipcRenderer.invoke('chat:regenerate', conversationId, model),
    editResend: (conversationId: string, index: number, newText: string): Promise<void> =>
      ipcRenderer.invoke('chat:edit-resend', conversationId, index, newText),
    stop: (conversationId: string): Promise<void> => ipcRenderer.invoke('chat:stop', conversationId),
    transcribe: (dataUrl: string): Promise<{ text?: string; error?: string }> =>
      ipcRenderer.invoke('chat:transcribe', dataUrl),
    verify: (input: VerifyInput): Promise<VerifyReport> => ipcRenderer.invoke('verify:run', input),
    pickAttachments: (): Promise<ChatAttachment[]> => ipcRenderer.invoke('chat:pick-attachments'),
    captureScreen: (): Promise<ChatAttachment | null> => ipcRenderer.invoke('chat:capture-screen'),
    respondTool: (requestId: string, decision: 'allow' | 'always' | 'deny'): Promise<void> =>
      ipcRenderer.invoke('chat:respond-tool', requestId, decision),
    exportDocx: (markdown: string, defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('export:docx', markdown, defaultName),
    exportXlsx: (markdown: string, defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('export:xlsx', markdown, defaultName),
    exportPptx: (markdown: string, defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('export:pptx', markdown, defaultName),
    exportText: (content: string, defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke('export:text', content, defaultName),
    setArtifact: (html: string): Promise<string> => ipcRenderer.invoke('artifact:set', html),
    onChunk: (cb: (e: ChatChunkEvent) => void): (() => void) => subscribe('chat:chunk', cb),
    onDocumentPreview: (cb: (e: DocumentPreviewEvent) => void): (() => void) =>
      subscribe('chat:document-preview', cb),
    onDone: (cb: (e: ChatDoneEvent) => void): (() => void) => subscribe('chat:done', cb),
    onError: (cb: (e: ChatErrorEvent) => void): (() => void) => subscribe('chat:error', cb),
    onToolRequest: (cb: (e: ToolRequestEvent) => void): (() => void) =>
      subscribe('chat:tool-request', cb)
  },

  cowork: {
    list: (): Promise<CoworkSessionMeta[]> => ipcRenderer.invoke('cowork:list'),
    get: (id: string): Promise<CoworkSession> => ipcRenderer.invoke('cowork:get', id),
    create: (providerId: string, modelId: string): Promise<CoworkSession> =>
      ipcRenderer.invoke('cowork:create', providerId, modelId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('cowork:delete', id),
    update: (
      id: string,
      patch: Partial<Pick<CoworkSession, 'providerId' | 'modelId' | 'mode' | 'workspace' | 'effort'>>
    ): Promise<CoworkSession> => ipcRenderer.invoke('cowork:update', id, patch),
    pickWorkspace: (id: string): Promise<CoworkSession> =>
      ipcRenderer.invoke('cowork:pick-workspace', id),
    send: (id: string, text: string): Promise<void> => ipcRenderer.invoke('cowork:send', id, text),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('cowork:stop', id),
    respondTool: (requestId: string, decision: 'allow' | 'always' | 'deny'): Promise<void> =>
      ipcRenderer.invoke('cowork:respond-tool', requestId, decision),
    onEvent: (cb: (e: CoworkEventPayload) => void): (() => void) => subscribe('cowork:event', cb),
    onToolRequest: (cb: (e: CoworkToolRequestEvent) => void): (() => void) =>
      subscribe('cowork:tool-request', cb)
  },

  swarm: {
    list: (): Promise<SwarmSessionMeta[]> => ipcRenderer.invoke('swarm:list'),
    get: (id: string): Promise<SwarmSession> => ipcRenderer.invoke('swarm:get', id),
    create: (providerId: string, modelId: string): Promise<SwarmSession> =>
      ipcRenderer.invoke('swarm:create', providerId, modelId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('swarm:delete', id),
    update: (
      id: string,
      patch: Partial<Pick<SwarmSession, 'managerProviderId' | 'managerModelId' | 'workers' | 'title'>>
    ): Promise<SwarmSession> => ipcRenderer.invoke('swarm:update', id, patch),
    run: (id: string, task: string): Promise<void> => ipcRenderer.invoke('swarm:run', id, task),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('swarm:stop', id),
    onEvent: (cb: (e: SwarmEventPayload) => void): (() => void) => subscribe('swarm:event', cb)
  },

  studio: {
    list: (): Promise<StudioSessionMeta[]> => ipcRenderer.invoke('studio:list'),
    get: (id: string): Promise<StudioSession> => ipcRenderer.invoke('studio:get', id),
    create: (providerId: string, modelId: string): Promise<StudioSession> =>
      ipcRenderer.invoke('studio:create', providerId, modelId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('studio:delete', id),
    update: (
      id: string,
      patch: Partial<Pick<StudioSession, 'providerId' | 'modelId' | 'title' | 'effort'>>
    ): Promise<StudioSession> => ipcRenderer.invoke('studio:update', id, patch),
    run: (id: string, prompt: string): Promise<void> => ipcRenderer.invoke('studio:run', id, prompt),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('studio:stop', id),
    previewUrl: (html: string): Promise<string> => ipcRenderer.invoke('studio:preview-url', html),
    openWindow: (html: string): Promise<void> => ipcRenderer.invoke('studio:open-window', html),
    onEvent: (cb: (e: StudioEventPayload) => void): (() => void) => subscribe('studio:event', cb)
  },

  forge: {
    list: (): Promise<ForgeSessionMeta[]> => ipcRenderer.invoke('forge:list'),
    get: (id: string): Promise<ForgeSession> => ipcRenderer.invoke('forge:get', id),
    create: (providerId: string, modelId: string): Promise<ForgeSession> =>
      ipcRenderer.invoke('forge:create', providerId, modelId),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('forge:delete', id),
    update: (
      id: string,
      patch: Partial<Pick<ForgeSession, 'providerId' | 'modelId' | 'mode' | 'workspace' | 'effort'>>
    ): Promise<ForgeSession> => ipcRenderer.invoke('forge:update', id, patch),
    pickWorkspace: (id: string): Promise<ForgeSession> =>
      ipcRenderer.invoke('forge:pick-workspace', id),
    setWorkspace: (id: string, folder: string): Promise<ForgeSession> =>
      ipcRenderer.invoke('forge:set-workspace', id, folder),
    send: (id: string, text: string): Promise<void> => ipcRenderer.invoke('forge:send', id, text),
    stop: (id: string): Promise<void> => ipcRenderer.invoke('forge:stop', id),
    respondTool: (requestId: string, decision: 'allow' | 'always' | 'deny'): Promise<void> =>
      ipcRenderer.invoke('forge:respond-tool', requestId, decision),
    onEvent: (cb: (e: ForgeEventPayload) => void): (() => void) => subscribe('forge:event', cb),
    onToolRequest: (cb: (e: ForgeToolRequestEvent) => void): (() => void) =>
      subscribe('forge:tool-request', cb)
  },

  skills: {
    list: (): Promise<SkillInfo[]> => ipcRenderer.invoke('skills:list'),
    setEnabled: (id: string, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke('skills:set-enabled', id, enabled),
    openFolder: (): Promise<void> => ipcRenderer.invoke('skills:open-folder'),
    delete: (id: string): Promise<void> => ipcRenderer.invoke('skills:delete', id),
    upload: (): Promise<{ ok: boolean; message: string } | null> =>
      ipcRenderer.invoke('skills:upload')
  },

  mcp: {
    list: (): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp:list'),
    sync: (): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp:sync'),
    add: (input: Omit<McpServerConfig, 'id'>): Promise<McpServerStatus[]> =>
      ipcRenderer.invoke('mcp:add', input),
    remove: (id: string): Promise<McpServerStatus[]> => ipcRenderer.invoke('mcp:remove', id),
    setEnabled: (id: string, enabled: boolean): Promise<McpServerStatus[]> =>
      ipcRenderer.invoke('mcp:set-enabled', id, enabled)
  },

  prompts: {
    list: (): Promise<PromptTemplate[]> => ipcRenderer.invoke('prompts:list'),
    save: (input: { id?: string; title: string; body: string }): Promise<PromptTemplate> =>
      ipcRenderer.invoke('prompts:save', input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('prompts:remove', id)
  },

  compare: {
    run: (runId: string, columns: CompareColumnInput[]): Promise<void> =>
      ipcRenderer.invoke('compare:run', runId, columns),
    stop: (runId: string): Promise<void> => ipcRenderer.invoke('compare:stop', runId),
    onChunk: (cb: (e: CompareChunkEvent) => void): (() => void) => subscribe('compare:chunk', cb),
    onDone: (cb: (e: CompareDoneEvent) => void): (() => void) => subscribe('compare:done', cb),
    onError: (cb: (e: CompareErrorEvent) => void): (() => void) => subscribe('compare:error', cb)
  },

  council: {
    run: (runId: string, input: CouncilRunInput): Promise<void> =>
      ipcRenderer.invoke('council:run', runId, input),
    stop: (runId: string): Promise<void> => ipcRenderer.invoke('council:stop', runId),
    onAnswerChunk: (cb: (e: CouncilAnswerChunkEvent) => void): (() => void) =>
      subscribe('council:answer-chunk', cb),
    onAnswerDone: (cb: (e: CouncilAnswerDoneEvent) => void): (() => void) =>
      subscribe('council:answer-done', cb),
    onVerdictChunk: (cb: (e: CouncilVerdictChunkEvent) => void): (() => void) =>
      subscribe('council:verdict-chunk', cb),
    onStatus: (cb: (e: CouncilStatusEvent) => void): (() => void) => subscribe('council:status', cb),
    onDone: (cb: (e: CouncilDoneEvent) => void): (() => void) => subscribe('council:done', cb),
    onError: (cb: (e: CouncilErrorEvent) => void): (() => void) => subscribe('council:error', cb)
  },

  benchmarks: {
    get: (): Promise<BenchmarkData> => ipcRenderer.invoke('benchmarks:get'),
    savePrompts: (prompts: BenchmarkPrompt[]): Promise<BenchmarkData> =>
      ipcRenderer.invoke('benchmarks:save-prompts', prompts),
    run: (runId: string, input: BenchmarkRunInput): Promise<BenchmarkRun | null> =>
      ipcRenderer.invoke('benchmarks:run', runId, input),
    stop: (runId: string): Promise<void> => ipcRenderer.invoke('benchmarks:stop', runId),
    onProgress: (cb: (e: { runId: string; text: string }) => void): (() => void) =>
      subscribe('benchmark:progress', cb),
    onDone: (cb: (e: { runId: string; run: BenchmarkRun | null }) => void): (() => void) =>
      subscribe('benchmark:done', cb),
    onError: (cb: (e: { runId: string; message: string }) => void): (() => void) =>
      subscribe('benchmark:error', cb)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
