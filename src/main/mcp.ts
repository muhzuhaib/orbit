import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpServerConfig, McpServerStatus } from '../shared/types'
import { getConfig } from './settings'

interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface Connection {
  client: Client
  tools: McpTool[]
  config: McpServerConfig
}

const connections = new Map<string, Connection>()
const errors = new Map<string, string>()

/** Bring live connections in line with the saved config. */
export async function syncMcp(): Promise<McpServerStatus[]> {
  const configs = getConfig().mcpServers

  // drop removed/disabled servers
  for (const [id, conn] of connections) {
    const cfg = configs.find((c) => c.id === id)
    if (!cfg || !cfg.enabled) {
      await conn.client.close().catch(() => {})
      connections.delete(id)
    }
  }

  // connect new/enabled servers
  for (const cfg of configs) {
    if (!cfg.enabled || connections.has(cfg.id)) continue
    try {
      const conn = await connect(cfg)
      connections.set(cfg.id, conn)
      errors.delete(cfg.id)
    } catch (err) {
      errors.set(cfg.id, err instanceof Error ? err.message : String(err))
    }
  }

  return statuses()
}

async function connect(cfg: McpServerConfig): Promise<Connection> {
  const client = new Client({ name: 'orbit', version: '0.1.0' })

  if (cfg.transport === 'stdio') {
    if (!cfg.command?.trim()) throw new Error('No command configured')
    const [command, ...args] = splitCommandLine(cfg.command)
    await client.connect(new StdioClientTransport({ command, args }))
  } else {
    if (!cfg.url?.trim()) throw new Error('No URL configured')
    await client.connect(new StreamableHTTPClientTransport(new URL(cfg.url)))
  }

  const result = await client.listTools()
  const tools: McpTool[] = result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>
  }))
  return { client, tools, config: cfg }
}

export function statuses(): McpServerStatus[] {
  return getConfig().mcpServers.map((cfg) => {
    const conn = connections.get(cfg.id)
    return {
      ...cfg,
      connected: !!conn,
      error: errors.get(cfg.id),
      toolNames: conn?.tools.map((t) => t.name) ?? []
    }
  })
}

export interface ExposedTool {
  /** unique key used as the AI SDK tool name */
  key: string
  serverName: string
  toolName: string
  description: string
  inputSchema: Record<string, unknown>
  call(args: unknown): Promise<string>
}

/** All tools from connected servers, ready to hand to the chat layer. */
export function exposedTools(): ExposedTool[] {
  const out: ExposedTool[] = []
  for (const conn of connections.values()) {
    for (const t of conn.tools) {
      out.push({
        key: sanitizeKey(`${conn.config.name}_${t.name}`),
        serverName: conn.config.name,
        toolName: t.name,
        description: `[${conn.config.name}] ${t.description ?? t.name}`,
        inputSchema: t.inputSchema,
        call: async (args) => {
          const result = await conn.client.callTool({
            name: t.name,
            arguments: (args ?? {}) as Record<string, unknown>
          })
          return contentToString(result)
        }
      })
    }
  }
  return out
}

function contentToString(result: unknown): string {
  const r = result as { content?: { type: string; text?: string }[]; isError?: boolean }
  const parts = (r.content ?? []).map((c) =>
    c.type === 'text' && c.text != null ? c.text : JSON.stringify(c)
  )
  const text = parts.join('\n') || JSON.stringify(result)
  return r.isError ? `Tool reported an error:\n${text}` : text
}

/** Tool names must satisfy provider naming rules (alnum, underscore, dash). */
function sanitizeKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64)
}

/** Split a command line into tokens, respecting double quotes. */
export function splitCommandLine(line: string): string[] {
  const tokens: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) tokens.push(m[1] ?? m[2])
  return tokens
}
