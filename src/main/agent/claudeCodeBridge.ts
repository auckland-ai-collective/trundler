import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolDef } from './types.js'

/**
 * Lets the Claude Code CLI use the grocery tools without a second trundler-mcp.
 *
 * The CLI owns its own agent loop and executes its own tools, so it needs an MCP
 * server of its own. Pointing it straight at trundler-mcp would work, but costs
 * a whole second instance (and a second Playwright graph) per message, and —
 * worse — would run cart mutations entirely outside the app, where the
 * approval gate the user has switched on cannot see them.
 *
 * So the CLI gets a PROXY instead: a tiny stdio MCP server that forwards every
 * call over loopback HTTP into this process, where the app's already-warm MCP
 * connection and its existing approval gate handle it. The CLI never touches
 * the grocery layer directly.
 *
 * The proxy is spawned by the CLI, not by us, so a back-channel is unavoidable.
 * It is bound to 127.0.0.1 with a per-run bearer token, and the token is passed
 * through the MCP config file rather than the command line so it stays off the
 * process table.
 */

export interface BridgeHandlers {
  listTools(): ToolDef[]
  /** Run one tool, having already passed it through the approval gate. */
  callTool(name: string, args: Record<string, unknown>): Promise<{ ok: boolean; data: unknown }>
}

/** How the proxy addresses us, and the secret that proves it is the proxy. */
export interface BridgeAddress {
  url: string
  token: string
}

export class ClaudeCodeBridge {
  private server: Server | null = null
  private token = ''
  private port = 0

  constructor(private handlers: BridgeHandlers) {}

  get address(): BridgeAddress | null {
    if (!this.server || !this.port) return null
    return { url: `http://127.0.0.1:${this.port}`, token: this.token }
  }

  /** Idempotent: a bridge already listening is reused across messages. */
  async start(): Promise<BridgeAddress> {
    const existing = this.address
    if (existing) return existing

    this.token = randomBytes(32).toString('hex')
    this.server = createServer((req, res) => {
      void this.route(req, res).catch((err) => {
        send(res, 500, { ok: false, data: { error: String(err?.message ?? err) } })
      })
    })

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      // Port 0 = let the OS pick a free one; loopback only, never a real interface.
      this.server!.listen(0, '127.0.0.1', () => resolve())
    })

    const addr = this.server.address()
    this.port = typeof addr === 'object' && addr ? addr.port : 0
    return this.address!
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.headers.authorization !== `Bearer ${this.token}`) {
      return send(res, 401, { ok: false, data: { error: 'bad token' } })
    }

    if (req.method === 'GET' && req.url === '/tools') {
      // The CLI needs JSON Schema under `inputSchema`; our ToolDef calls it
      // `parameters` (the shape the chat-completions backends want).
      return send(res, 200, {
        tools: this.handlers.listTools().map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters
        }))
      })
    }

    if (req.method === 'POST' && req.url === '/call') {
      const body = await readBody(req)
      let parsed: { name?: string; args?: Record<string, unknown> }
      try {
        parsed = JSON.parse(body)
      } catch {
        return send(res, 400, { ok: false, data: { error: 'bad JSON' } })
      }
      if (!parsed.name) return send(res, 400, { ok: false, data: { error: 'no tool name' } })
      const result = await this.handlers.callTool(parsed.name, parsed.args ?? {})
      return send(res, 200, result)
    }

    send(res, 404, { ok: false, data: { error: 'no such endpoint' } })
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    this.port = 0
    this.token = ''
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

function send(res: ServerResponse, code: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(code, {
    'Content-Type': 'application/json',
    'Content-Length': String(Buffer.byteLength(body))
  })
  res.end(body)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

// ---- the proxy MCP server, and the config that points the CLI at it ---------

/**
 * Source for the stdio MCP server the CLI spawns.
 *
 * Hand-rolled JSON-RPC rather than the MCP SDK, on purpose. This file is run as
 * a CHILD of the CLI, not of Electron, so it cannot rely on our module graph —
 * and in a packaged build an SDK import would have to resolve inside app.asar,
 * which is exactly the kind of thing that works in dev and breaks on install.
 * With no imports at all there is nothing to resolve: any Node ≥18 can run it.
 *
 * Deliberately written without template literals so it can live inside one here
 * without a thicket of escapes.
 */
const PROXY_SOURCE = [
  '// Generated by Trundler. Proxies MCP tool calls back into the app.',
  '// Do not edit: rewritten on every launch.',
  'const URL_BASE = process.env.TRUNDLER_BRIDGE_URL',
  'const TOKEN = process.env.TRUNDLER_BRIDGE_TOKEN',
  'const HEADERS = { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }',
  '',
  'function send(msg) { process.stdout.write(JSON.stringify(msg) + "\\n") }',
  'function warn(m) { process.stderr.write("[trundler-proxy] " + m + "\\n") }',
  '',
  'async function handle(req) {',
  '  switch (req.method) {',
  '    case "initialize":',
  '      return {',
  '        // Echo the client\'s version: it picked one we are compatible with,',
  '        // since this proxy only does the universal tools/* subset.',
  '        protocolVersion: (req.params && req.params.protocolVersion) || "2025-06-18",',
  '        capabilities: { tools: {} },',
  '        serverInfo: { name: "trundler", version: "1.0.0" }',
  '      }',
  '    case "ping":',
  '      return {}',
  '    case "tools/list": {',
  '      const r = await fetch(URL_BASE + "/tools", { headers: HEADERS })',
  '      if (!r.ok) throw new Error("bridge /tools " + r.status)',
  '      return await r.json()',
  '    }',
  '    case "tools/call": {',
  '      const name = req.params && req.params.name',
  '      const args = (req.params && req.params.arguments) || {}',
  '      const r = await fetch(URL_BASE + "/call", {',
  '        method: "POST",',
  '        headers: HEADERS,',
  '        body: JSON.stringify({ name: name, args: args })',
  '      })',
  '      if (!r.ok) throw new Error("bridge /call " + r.status)',
  '      const out = await r.json()',
  '      // The payload goes back as one JSON text block, matching what',
  '      // trundler-mcp itself returns, so the model sees an identical shape.',
  '      return {',
  '        content: [{ type: "text", text: JSON.stringify(out.data) }],',
  '        isError: out.ok === false',
  '      }',
  '    }',
  '    default:',
  '      throw Object.assign(new Error("Unknown method: " + req.method), { code: -32601 })',
  '  }',
  '}',
  '',
  'let buf = ""',
  'process.stdin.on("data", async function (chunk) {',
  '  buf += chunk',
  '  let nl',
  '  while ((nl = buf.indexOf("\\n")) !== -1) {',
  '    const line = buf.slice(0, nl).trim()',
  '    buf = buf.slice(nl + 1)',
  '    if (!line) continue',
  '    let req',
  '    try { req = JSON.parse(line) } catch (e) { warn("unparseable line"); continue }',
  '    // No id means a notification — the spec forbids answering those.',
  '    if (req.id === undefined || req.id === null) continue',
  '    try {',
  '      send({ jsonrpc: "2.0", id: req.id, result: await handle(req) })',
  '    } catch (err) {',
  '      send({',
  '        jsonrpc: "2.0",',
  '        id: req.id,',
  '        error: { code: err && err.code ? err.code : -32603, message: String(err && err.message ? err.message : err) }',
  '      })',
  '    }',
  '  }',
  '})',
  ''
].join('\n')

/** Where the generated proxy, its MCP config, and the system prompt are kept. */
export interface ClaudeCodeWorkspace {
  /** Passed to `--mcp-config`. */
  mcpConfigPath: string
  /** Passed to `--system-prompt-file`. */
  systemPromptPath: string
  /** The CLI's working directory — kept empty so no stray CLAUDE.md is found. */
  cwd: string
}

/**
 * Lay out the files the CLI run needs, under the app's own data directory.
 *
 * Written fresh each launch: the bridge port and token change every run, so a
 * stale config would point the proxy at nothing.
 */
export function writeClaudeCodeWorkspace(
  baseDir: string,
  address: BridgeAddress,
  systemPrompt: string,
  nodeCommand: string
): ClaudeCodeWorkspace {
  const dir = join(baseDir, 'claude-code')
  // An empty directory the CLI can treat as the project root. Nothing is put
  // here, which is the point: no CLAUDE.md, no repo, nothing to discover.
  const cwd = join(dir, 'workspace')
  mkdirSync(cwd, { recursive: true })

  const proxyPath = join(dir, 'mcp-proxy.mjs')
  writeFileSync(proxyPath, PROXY_SOURCE, 'utf-8')

  const mcpConfigPath = join(dir, 'mcp-config.json')
  writeFileSync(
    mcpConfigPath,
    JSON.stringify(
      {
        mcpServers: {
          // The server key becomes the tool-name prefix: mcp__trundler__<tool>.
          trundler: {
            command: nodeCommand,
            args: [proxyPath],
            env: {
              TRUNDLER_BRIDGE_URL: address.url,
              TRUNDLER_BRIDGE_TOKEN: address.token,
              // Electron's binary doubles as Node with this set, so the proxy
              // runs without the machine needing its own Node install.
              ELECTRON_RUN_AS_NODE: '1'
            }
          }
        }
      },
      null,
      2
    ),
    'utf-8'
  )

  const systemPromptPath = join(dir, 'system-prompt.txt')
  writeFileSync(systemPromptPath, systemPrompt, 'utf-8')

  return { mcpConfigPath, systemPromptPath, cwd }
}

/** A session id for a fresh conversation (the CLI requires a v4 UUID). */
export function newSessionId(): string {
  return randomUUID()
}
