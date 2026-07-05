import { dirname } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { ToolDef } from './agent/types.js'

/**
 * Owns the trundler-mcp subprocess and exposes a thin tool interface.
 * The server is spawned over stdio; we run it with Electron's bundled Node
 * (ELECTRON_RUN_AS_NODE) so no separate system Node install is required.
 */
export class TrundlerMcp {
  private client: Client | null = null
  private transport: StdioClientTransport | null = null
  private tools: ToolDef[] = []
  instructions = ''

  async connect(serverPath: string, nodePath: string): Promise<void> {
    this.transport = new StdioClientTransport({
      command: nodePath,
      args: [serverPath],
      cwd: dirname(serverPath),
      env: { ...(process.env as Record<string, string>), ELECTRON_RUN_AS_NODE: '1' },
      stderr: 'inherit'
    })

    this.client = new Client(
      { name: 'trundler-app', version: '0.1.0' },
      { capabilities: {} }
    )

    await this.client.connect(this.transport)

    // Server-level presentation instructions (letter labels, price-per-unit,
    // cheapest-first). Surface them to the model verbatim.
    const anyClient = this.client as unknown as { getInstructions?: () => string | undefined }
    this.instructions = anyClient.getInstructions?.() ?? ''

    const listed = await this.client.listTools()
    this.tools = listed.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: normaliseSchema(t.inputSchema)
    }))
  }

  getTools(): ToolDef[] {
    return this.tools
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.client) throw new Error('MCP client not connected')
    const result = await this.client.callTool({ name, arguments: args })
    return parseToolResult(result)
  }

  async close(): Promise<void> {
    try {
      await this.client?.close()
    } catch {
      /* ignore */
    }
    this.client = null
    this.transport = null
  }
}

/** trundler returns a single text block of JSON — parse it back to an object. */
export function parseToolResult(result: unknown): unknown {
  const content = (result as { content?: Array<{ type: string; text?: string }> })?.content
  if (Array.isArray(content)) {
    const text = content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text as string)
      .join('\n')
    if (text) {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
  }
  return result
}

/** Ensure the JSON Schema is a plain object with a `type` LLM backends accept. */
function normaliseSchema(schema: unknown): Record<string, unknown> {
  if (schema && typeof schema === 'object') {
    const s = schema as Record<string, unknown>
    if (!s.type) s.type = 'object'
    if (!s.properties) s.properties = {}
    return s
  }
  return { type: 'object', properties: {} }
}
