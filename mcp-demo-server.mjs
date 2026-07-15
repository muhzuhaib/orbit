// Orbit demo MCP server (stdio). Register in Orbit Settings as:
//   node C:\Users\Batman\Downloads\Claude\orbit\mcp-demo-server.mjs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'orbit-demo', version: '1.0.0' })

server.registerTool(
  'get_current_time',
  { description: 'Get the current local date and time' },
  async () => ({ content: [{ type: 'text', text: new Date().toString() }] })
)

server.registerTool(
  'roll_dice',
  {
    description: 'Roll dice and return the results',
    inputSchema: { count: z.number().int().min(1).max(20), sides: z.number().int().min(2).max(1000) }
  },
  async ({ count, sides }) => {
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides))
    return { content: [{ type: 'text', text: `Rolled ${count}d${sides}: ${rolls.join(', ')} (total ${rolls.reduce((a, b) => a + b, 0)})` }] }
  }
)

await server.connect(new StdioServerTransport())
