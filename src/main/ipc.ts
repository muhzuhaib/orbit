import { app, dialog, desktopCapturer, ipcMain, screen, BrowserWindow } from 'electron'
import { basename, extname } from 'path'
import { existsSync, readFileSync, statSync } from 'fs'
import type {
  ChatAttachment,
  Conversation,
  CustomModelInput,
  CustomProviderInput,
  McpServerConfig,
  Project
} from '../shared/types'
import * as settings from './settings'
import * as conversations from './conversations'
import * as projects from './projects'
import { detectOllama, listModels, listProviders } from './registry'
import { testProvider } from './providers'
import {
  classifyDifficulty,
  editAndResend,
  regenerateChat,
  respondToolRequest,
  sendChat,
  stopChat,
  transcribeAudio
} from './chat'
import * as cowork from './cowork'
import * as swarm from './swarm'
import * as studio from './studio'
import * as forge from './forge'
import { runCompare, stopCompare } from './compare'
import { runCouncil, stopCouncil } from './council'
import { getBenchmarks, runBenchmark, savePrompts, stopBenchmark } from './benchmarks'
import type {
  BenchmarkPrompt,
  BenchmarkRunInput,
  CompareColumnInput,
  CouncilRunInput
} from '../shared/types'
import { statuses, syncMcp } from './mcp'
import * as skills from './skills'
import { exportMarkdownToOffice } from './office'
import { setArtifact } from './artifacts'
import { getMemory, setMemory } from './memory'
import { verifyAnswer } from './verify'
import type { VerifyInput } from '../shared/types'
import { writeFileSync } from 'fs'

export function registerIpc(): void {
  ipcMain.handle('app:version', () => app.getVersion())

  // Recolour the frameless title-bar overlay so its window controls match the
  // current app theme (called by the renderer whenever the theme flips).
  ipcMain.handle('window:titlebar', (e, dark: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    try {
      win?.setTitleBarOverlay({
        color: dark ? '#1b1b1d' : '#ffffff',
        symbolColor: dark ? '#9a9aa2' : '#61636f',
        height: 40
      })
    } catch {
      // setTitleBarOverlay is Windows-only / no-op if the frame isn't overlaid.
    }
  })

  // Native confirm dialog (clear Yes/Cancel) for destructive actions
  ipcMain.handle('ui:confirm', async (e, message: string, detail?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const { response } = await dialog.showMessageBox(win!, {
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 1,
      cancelId: 0,
      message,
      detail
    })
    return response === 1
  })

  ipcMain.handle('providers:list', () => listProviders())
  ipcMain.handle('providers:set-key', (_e, id: string, key: string) => settings.setKey(id, key))
  ipcMain.handle('providers:delete-key', (_e, id: string) => settings.deleteKey(id))
  ipcMain.handle('providers:test', (_e, id: string) => testProvider(id))
  ipcMain.handle('providers:add-custom', (_e, input: CustomProviderInput) =>
    settings.addCustomProvider(input)
  )
  ipcMain.handle('providers:remove-custom', (_e, id: string) => settings.removeCustomProvider(id))
  ipcMain.handle('providers:set-plan', (_e, id: string, plan: 'free' | 'paid') =>
    settings.setProviderPlan(id, plan)
  )

  ipcMain.handle('settings:get-math-format', () => settings.getMathFormat())
  ipcMain.handle('settings:set-math-format', (_e, format: 'latex' | 'unicode') =>
    settings.setMathFormat(format)
  )

  ipcMain.handle('models:list', () => listModels())
  ipcMain.handle('models:refresh', () => listModels(true))
  ipcMain.handle('models:add-custom', (_e, input: CustomModelInput) =>
    settings.addCustomModel(input)
  )
  ipcMain.handle('models:remove-custom', (_e, providerId: string, modelId: string) =>
    settings.removeCustomModel(providerId, modelId)
  )

  ipcMain.handle('conversations:list', () => conversations.listConversations())
  ipcMain.handle('conversations:search', (_e, query: string) =>
    conversations.searchConversations(query)
  )
  ipcMain.handle('conversations:get', (_e, id: string) => conversations.getConversation(id))
  ipcMain.handle(
    'conversations:create',
    (_e, providerId: string, modelId: string, projectId?: string) =>
      conversations.createConversation(providerId, modelId, projectId)
  )
  ipcMain.handle('conversations:delete', (_e, id: string) => conversations.deleteConversation(id))
  ipcMain.handle('conversations:delete-many', (_e, ids: string[]) =>
    conversations.deleteConversations(ids)
  )
  ipcMain.handle('conversations:delete-all', () => conversations.deleteAllConversations())
  ipcMain.handle(
    'conversations:update',
    (
      _e,
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
    ) => conversations.updateConversation(id, patch)
  )

  // Folders (organise chats)
  ipcMain.handle('folders:list', () => settings.listFolders())
  ipcMain.handle('folders:create', (_e, name: string) => settings.createFolder(name))
  ipcMain.handle('folders:rename', (_e, id: string, name: string) => settings.renameFolder(id, name))
  ipcMain.handle('folders:delete', (_e, id: string) => settings.deleteFolder(id))

  ipcMain.handle(
    'chat:send',
    (
      e,
      conversationId: string,
      text: string,
      attachments?: ChatAttachment[],
      model?: { providerId: string; modelId: string }
    ) => sendChat(e.sender, conversationId, text, attachments, model)
  )
  ipcMain.handle(
    'chat:classify',
    (_e, providerId: string, modelId: string, text: string) =>
      classifyDifficulty(providerId, modelId, text)
  )
  ipcMain.handle(
    'chat:regenerate',
    (e, conversationId: string, model?: { providerId: string; modelId: string }) =>
      regenerateChat(e.sender, conversationId, model)
  )
  ipcMain.handle('chat:edit-resend', (e, conversationId: string, index: number, newText: string) =>
    editAndResend(e.sender, conversationId, index, newText)
  )
  ipcMain.handle('chat:stop', (_e, conversationId: string) => stopChat(conversationId))
  // Voice dictation: transcribe a recorded WAV (data URL) to text via Gemini.
  ipcMain.handle('chat:transcribe', (_e, dataUrl: string) => transcribeAudio(dataUrl))
  // Verify (hallucination check): re-examine an assistant answer, optionally
  // grounded with a live web search. Always resolves to a report (never throws).
  ipcMain.handle('verify:run', async (_e, input: VerifyInput) => {
    try {
      return await verifyAnswer(input)
    } catch (err) {
      return {
        verdict: 'uncertain',
        confidence: null,
        summary: `The check could not run: ${err instanceof Error ? err.message : String(err)}`,
        claims: [],
        error: 'failed'
      }
    }
  })
  ipcMain.handle('chat:respond-tool', (_e, requestId: string, decision: 'allow' | 'always' | 'deny') =>
    respondToolRequest(requestId, decision)
  )

  // Pick files, extract text (documents) or load as data URL (images)
  const IMAGE_MIME: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp'
  }
  ipcMain.handle('chat:pick-attachments', async (e): Promise<ChatAttachment[]> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Attach files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Documents & images',
          extensions: [
            'docx', 'xlsx', 'xls', 'pptx', 'pdf', 'txt', 'md', 'markdown', 'csv', 'json', 'log',
            'png', 'jpg', 'jpeg', 'gif', 'webp'
          ]
        }
      ]
    })
    if (result.canceled) return []
    const attachments: ChatAttachment[] = []
    for (const filePath of result.filePaths) {
      const ext = extname(filePath).toLowerCase()
      try {
        if (IMAGE_MIME[ext]) {
          const buf = readFileSync(filePath)
          if (buf.length > 8 * 1024 * 1024) {
            attachments.push({ name: basename(filePath), text: '(image larger than 8 MB — not attached)' })
          } else {
            attachments.push({
              name: basename(filePath),
              image: `data:${IMAGE_MIME[ext]};base64,${buf.toString('base64')}`
            })
          }
        } else {
          const text = await projects.extractText(filePath, ext)
          attachments.push({ name: basename(filePath), text: text.slice(0, 150_000) })
        }
      } catch {
        attachments.push({ name: basename(filePath), text: '(could not read this file)' })
      }
    }
    return attachments
  })

  // Capture the primary screen as an image attachment
  ipcMain.handle('chat:capture-screen', async (): Promise<ChatAttachment | null> => {
    const { width, height } = screen.getPrimaryDisplay().size
    const scale = screen.getPrimaryDisplay().scaleFactor || 1
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
    })
    const primary = sources[0]
    if (!primary || primary.thumbnail.isEmpty()) return null
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-')
    return { name: `screenshot-${stamp}.png`, image: primary.thumbnail.toDataURL() }
  })

  // Export assistant markdown as Office documents via save dialog
  ipcMain.handle('export:docx', (e, markdown: string, defaultName: string) =>
    exportMarkdownToOffice(BrowserWindow.fromWebContents(e.sender), 'docx', markdown, defaultName)
  )
  ipcMain.handle('export:xlsx', (e, markdown: string, defaultName: string) =>
    exportMarkdownToOffice(BrowserWindow.fromWebContents(e.sender), 'xlsx', markdown, defaultName)
  )
  ipcMain.handle('export:pptx', (e, markdown: string, defaultName: string) =>
    exportMarkdownToOffice(BrowserWindow.fromWebContents(e.sender), 'pptx', markdown, defaultName)
  )

  // Artifacts (split-screen preview of model-generated HTML/SVG)
  ipcMain.handle('artifact:set', (_e, html: string) => setArtifact(html))
  ipcMain.handle('export:text', async (e, content: string, defaultName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showSaveDialog(win!, {
      title: 'Save file',
      defaultPath: defaultName,
      filters: [{ name: 'All files', extensions: ['*'] }]
    })
    if (result.canceled || !result.filePath) return null
    writeFileSync(result.filePath, content, 'utf-8')
    return result.filePath
  })

  // Persistent memory
  ipcMain.handle('memory:get', () => getMemory())
  ipcMain.handle('memory:set', (_e, content: string) => setMemory(content))

  // Skills
  ipcMain.handle('skills:list', () => skills.listSkills())
  ipcMain.handle('skills:set-enabled', (_e, id: string, enabled: boolean) =>
    skills.setSkillEnabled(id, enabled)
  )
  ipcMain.handle('skills:open-folder', () => skills.openSkillsFolder())
  ipcMain.handle('skills:delete', (_e, id: string) => skills.deleteSkill(id))
  ipcMain.handle('skills:upload', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Upload skill',
      properties: ['openFile'],
      filters: [{ name: 'Skill (.zip or .md)', extensions: ['zip', 'md'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return skills.importSkill(result.filePaths[0])
  })

  // Cowork
  ipcMain.handle('cowork:list', () => cowork.listSessions())
  ipcMain.handle('cowork:get', (_e, id: string) => cowork.getSession(id))
  ipcMain.handle('cowork:create', (_e, providerId: string, modelId: string) =>
    cowork.createSession(providerId, modelId)
  )
  ipcMain.handle('cowork:delete', (_e, id: string) => cowork.deleteSession(id))
  ipcMain.handle(
    'cowork:update',
    (_e, id: string, patch: Parameters<typeof cowork.updateSession>[1]) =>
      cowork.updateSession(id, patch)
  )
  ipcMain.handle('cowork:pick-workspace', async (e, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Choose the folder Assistant may work in',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return cowork.getSession(id)
    return cowork.updateSession(id, { workspace: result.filePaths[0] })
  })
  ipcMain.handle('cowork:send', (e, id: string, text: string) => cowork.sendCowork(e.sender, id, text))
  ipcMain.handle('cowork:stop', (_e, id: string) => cowork.stopCowork(id))
  ipcMain.handle('cowork:respond-tool', (_e, requestId: string, decision: 'allow' | 'always' | 'deny') =>
    cowork.respondCoworkTool(requestId, decision)
  )

  // Swarm (multi-agent orchestration — beta; separate storage from Cowork)
  ipcMain.handle('swarm:list', () => swarm.listSessions())
  ipcMain.handle('swarm:get', (_e, id: string) => swarm.getSession(id))
  ipcMain.handle('swarm:create', (_e, providerId: string, modelId: string) =>
    swarm.createSession(providerId, modelId)
  )
  ipcMain.handle('swarm:delete', (_e, id: string) => swarm.deleteSession(id))
  ipcMain.handle('swarm:update', (_e, id: string, patch: Parameters<typeof swarm.updateSession>[1]) =>
    swarm.updateSession(id, patch)
  )
  ipcMain.handle('swarm:run', (e, id: string, task: string) => swarm.runSwarm(e.sender, id, task))
  ipcMain.handle('swarm:stop', (_e, id: string) => swarm.stopSwarm(id))

  // Studio (design — self-contained HTML pages with live preview; own storage)
  ipcMain.handle('studio:list', () => studio.listSessions())
  ipcMain.handle('studio:get', (_e, id: string) => studio.getSession(id))
  ipcMain.handle('studio:create', (_e, providerId: string, modelId: string) =>
    studio.createSession(providerId, modelId)
  )
  ipcMain.handle('studio:delete', (_e, id: string) => studio.deleteSession(id))
  ipcMain.handle('studio:update', (_e, id: string, patch: Parameters<typeof studio.updateSession>[1]) =>
    studio.updateSession(id, patch)
  )
  ipcMain.handle('studio:run', (e, id: string, prompt: string) => studio.runStudio(e.sender, id, prompt))
  ipcMain.handle('studio:stop', (_e, id: string) => studio.stopStudio(id))
  ipcMain.handle('studio:preview-url', (_e, html: string) => studio.previewUrlFor(html))
  ipcMain.handle('studio:open-window', (_e, html: string) => studio.openWindow(html))

  // Forge (Claude Code clone — developer coding environment; own storage from Cowork)
  ipcMain.handle('forge:list', () => forge.listSessions())
  ipcMain.handle('forge:get', (_e, id: string) => forge.getSession(id))
  ipcMain.handle('forge:create', (_e, providerId: string, modelId: string) =>
    forge.createSession(providerId, modelId)
  )
  ipcMain.handle('forge:delete', (_e, id: string) => forge.deleteSession(id))
  ipcMain.handle('forge:update', (_e, id: string, patch: Parameters<typeof forge.updateSession>[1]) =>
    forge.updateSession(id, patch)
  )
  ipcMain.handle('forge:pick-workspace', async (e, id: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Open a project folder for Forge',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return forge.getSession(id)
    return forge.updateSession(id, { workspace: result.filePaths[0] })
  })
  ipcMain.handle('forge:set-workspace', (_e, id: string, folder: string) => {
    if (!folder || !existsSync(folder) || !statSync(folder).isDirectory()) {
      throw new Error('That folder path was not found. Check the path and try again.')
    }
    return forge.updateSession(id, { workspace: folder })
  })
  ipcMain.handle('forge:send', (e, id: string, text: string) => forge.sendForge(e.sender, id, text))
  ipcMain.handle('forge:stop', (_e, id: string) => forge.stopForge(id))
  ipcMain.handle('forge:respond-tool', (_e, requestId: string, decision: 'allow' | 'always' | 'deny') =>
    forge.respondForgeTool(requestId, decision)
  )

  // MCP servers
  ipcMain.handle('mcp:list', () => statuses())
  ipcMain.handle('mcp:sync', () => syncMcp())
  ipcMain.handle('mcp:add', async (_e, input: Omit<McpServerConfig, 'id'>) => {
    settings.addMcpServer(input)
    return syncMcp()
  })
  ipcMain.handle('mcp:remove', async (_e, id: string) => {
    settings.removeMcpServer(id)
    return syncMcp()
  })
  ipcMain.handle('mcp:set-enabled', async (_e, id: string, enabled: boolean) => {
    settings.setMcpServerEnabled(id, enabled)
    return syncMcp()
  })

  ipcMain.handle('projects:list', () => projects.listProjects())
  ipcMain.handle('projects:get', (_e, id: string) => projects.getProject(id))
  ipcMain.handle('projects:create', (_e, name: string) => projects.createProject(name))
  ipcMain.handle('projects:delete', (_e, id: string) => projects.deleteProject(id))
  ipcMain.handle(
    'projects:update',
    (_e, id: string, patch: Partial<Pick<Project, 'name' | 'instructions'>>) =>
      projects.updateProject(id, patch)
  )
  ipcMain.handle('projects:remove-file', (_e, projectId: string, fileId: string) =>
    projects.removeFile(projectId, fileId)
  )
  ipcMain.handle('projects:add-files', async (e, projectId: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const result = await dialog.showOpenDialog(win!, {
      title: 'Attach files to project',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['txt', 'md', 'markdown', 'pdf', 'docx', 'json', 'csv', 'log'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return projects.getProject(projectId)
    return projects.ingestFiles(projectId, result.filePaths)
  })

  // Prompt templates
  ipcMain.handle('prompts:list', () => settings.listPromptTemplates())
  ipcMain.handle('prompts:save', (_e, input: { id?: string; title: string; body: string }) =>
    settings.savePromptTemplate(input)
  )
  ipcMain.handle('prompts:remove', (_e, id: string) => settings.removePromptTemplate(id))

  // Model compare (side-by-side)
  ipcMain.handle('compare:run', (e, runId: string, columns: CompareColumnInput[]) =>
    runCompare(e.sender, runId, columns)
  )
  ipcMain.handle('compare:stop', (_e, runId: string) => stopCompare(runId))

  // Council (beta): panelists answer, then a judge writes a verdict
  ipcMain.handle('council:run', (e, runId: string, input: CouncilRunInput) =>
    runCouncil(e.sender, runId, input)
  )
  ipcMain.handle('council:stop', (_e, runId: string) => stopCouncil(runId))

  // Personal benchmarks (beta)
  ipcMain.handle('benchmarks:get', () => getBenchmarks())
  ipcMain.handle('benchmarks:save-prompts', (_e, prompts: BenchmarkPrompt[]) => savePrompts(prompts))
  ipcMain.handle('benchmarks:run', (e, runId: string, input: BenchmarkRunInput) =>
    runBenchmark(e.sender, runId, input)
  )
  ipcMain.handle('benchmarks:stop', (_e, runId: string) => stopBenchmark(runId))

  ipcMain.handle('ollama:detect', () => detectOllama())
  ipcMain.handle('ollama:set-url', (_e, url: string) => {
    settings.updateConfig({ ollamaUrl: url.replace(/\/$/, '') })
    return detectOllama()
  })
}
