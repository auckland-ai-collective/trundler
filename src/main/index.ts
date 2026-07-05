import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { TrundlerMcp } from './mcpClient.js'
import { OllamaBackend } from './agent/ollamaBackend.js'
import { AnthropicBackend } from './agent/anthropicBackend.js'
import { runAgent } from './agent/loop.js'
import { buildSystemPrompt } from './agent/system.js'
import { Logger, debugEnabled } from './logger.js'
import type { Backend, ChatMessage } from './agent/types.js'
import type { AgentEvent, AppConfig, ToolCall } from '../shared/types.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null
const mcp = new TrundlerMcp()
let config: AppConfig = { backend: 'ollama' } as AppConfig
let history: ChatMessage[] = []
let systemPrompt = ''
let currentRun: AbortController | null = null
let logger: Logger
let assistantBuf = ''
const pendingApprovals = new Map<string, (approved: boolean) => void>()

function modelInfo(cfg: AppConfig): { backend: string; model: string } {
  return cfg.backend === 'anthropic'
    ? { backend: 'anthropic', model: cfg.anthropic.model }
    : { backend: 'ollama', model: cfg.ollama.model }
}

function cartSummary(data: unknown): Record<string, unknown> {
  const d = (data ?? {}) as { items?: unknown[]; totals?: Record<string, unknown>; error?: string }
  if (d.error) return { error: d.error }
  return {
    itemCount: d.totals?.itemCount ?? d.items?.length,
    total: d.totals?.total,
    detailedItems: Array.isArray(d.items)
      ? d.items.filter((i) => i && typeof i === 'object' && Object.keys(i).length > 0).length
      : 0,
    totals: d.totals
  }
}

function emit(evt: AgentEvent): void {
  mainWindow?.webContents.send('agent:event', evt)
  logAgentEvent(evt)
}

/** Mirror the streamed agent events into the session log. */
function logAgentEvent(evt: AgentEvent): void {
  if (!logger?.enabled) return
  switch (evt.type) {
    case 'text':
      assistantBuf += evt.delta
      break
    case 'tool-call':
      flushAssistant()
      logger.event('mcp-call', { name: evt.call.name, args: evt.call.args })
      break
    case 'tool-result':
      logger.event('mcp-result', { name: evt.name, ok: evt.ok, provider: evt.provider, data: evt.data })
      if (evt.name === 'cart_get') logger.event('cart-state', { provider: evt.provider, ...cartSummary(evt.data) })
      break
    case 'approval':
      logger.event('approval-request', { name: evt.call.name, args: evt.call.args })
      break
    case 'error':
      flushAssistant()
      logger.event('agent-error', { message: evt.message })
      break
    case 'done':
      flushAssistant()
      break
  }
}

function flushAssistant(): void {
  if (assistantBuf.trim()) logger.event('assistant-text', { text: assistantBuf })
  assistantBuf = ''
}

function makeBackend(cfg: AppConfig): Backend {
  if (cfg.backend === 'anthropic') {
    return new AnthropicBackend(cfg.anthropic.apiKey, cfg.anthropic.model)
  }
  return new OllamaBackend(cfg.ollama.baseUrl, cfg.ollama.model)
}

function providerOf(call: ToolCall): string {
  const p = call.args?.provider
  return typeof p === 'string' && p ? p : config.defaultProvider
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161b',
    title: 'Trundler',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Open product links / external URLs in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function boot(): Promise<void> {
  config = loadConfig()
  logger = new Logger(debugEnabled())
  try {
    await mcp.connect(config.mcpServerPath, process.execPath)
    systemPrompt = buildSystemPrompt(mcp.instructions, config.defaultProvider)
    console.log(`[trundler] MCP connected, ${mcp.getTools().length} tools`)
    logger.event('session-start', {
      appVersion: app.getVersion(),
      ...modelInfo(config),
      provider: config.defaultProvider,
      mcpServerPath: config.mcpServerPath,
      tools: mcp.getTools().length,
      toolNames: mcp.getTools().map((t) => t.name),
      systemPrompt
    })
  } catch (err) {
    console.error('[trundler] MCP connection failed:', err)
    logger.event('session-start', {
      appVersion: app.getVersion(),
      ...modelInfo(config),
      mcpError: err instanceof Error ? err.message : String(err)
    })
  }
}

// ---- IPC ------------------------------------------------------------------

ipcMain.handle('config:get', () => config)

ipcMain.handle('config:set', (_e, next: AppConfig) => {
  const before = modelInfo(config)
  config = next
  saveConfig(config)
  systemPrompt = buildSystemPrompt(mcp.instructions, config.defaultProvider)
  const after = modelInfo(config)
  if (before.backend !== after.backend || before.model !== after.model) {
    logger?.event('backend-change', { from: before, to: after, provider: config.defaultProvider })
  }
  return config
})

ipcMain.handle('debug:info', () => logger?.info() ?? { enabled: false, path: '' })
ipcMain.handle('debug:open', () => logger?.openFolder())

ipcMain.handle('tools:list', () =>
  mcp.getTools().map((t) => ({ name: t.name, description: t.description }))
)

ipcMain.handle('chat:reset', () => {
  history = []
  assistantBuf = ''
  logger?.event('chat-reset', {})
  return true
})

/** Direct, user-initiated MCP call (cart panel refresh, add button, store setup). */
ipcMain.handle('mcp:call', async (_e, name: string, args: Record<string, unknown>) => {
  try {
    const data = await mcp.callTool(name, args ?? {})
    const ok = !(data && typeof data === 'object' && 'error' in (data as object))
    logger?.event('mcp-direct-call', { name, args, ok, data })
    if (name === 'cart_get') {
      const provider = (args?.provider as string) || config.defaultProvider
      logger?.event('cart-state', { provider, source: 'refresh', ...cartSummary(data) })
    }
    return { ok, data }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger?.event('mcp-direct-call', { name, args, ok: false, error: message })
    return { ok: false, data: { error: message } }
  }
})

ipcMain.handle('approval:respond', (_e, id: string, approved: boolean) => {
  logger?.event('approval-response', { id, approved })
  pendingApprovals.get(id)?.(approved)
  pendingApprovals.delete(id)
})

ipcMain.handle('chat:cancel', () => {
  currentRun?.abort()
})

ipcMain.handle('chat:send', async (_e, text: string) => {
  if (!mcp.getTools().length) {
    emit({ type: 'error', message: 'MCP is not connected. Check the server path in Settings.' })
    emit({ type: 'done' })
    return
  }

  history.push({ role: 'user', content: text })
  const backend = makeBackend(config)
  currentRun = new AbortController()
  logger?.event('user-message', { text, ...modelInfo(config), provider: config.defaultProvider })

  try {
    await runAgent(
      backend,
      systemPrompt,
      history,
      mcp.getTools(),
      {
        onText: (delta) => emit({ type: 'text', delta }),
        onToolCall: (call) => emit({ type: 'tool-call', call }),
        onToolResult: (call, ok, data) =>
          emit({ type: 'tool-result', id: call.id, name: call.name, ok, provider: providerOf(call), data }),
        callTool: (name, args) => mcp.callTool(name, args),
        requestApproval: (call) =>
          new Promise<boolean>((resolve) => {
            pendingApprovals.set(call.id, resolve)
            emit({ type: 'approval', id: call.id, call })
          })
      },
      currentRun.signal
    )
    emit({ type: 'done' })
  } catch (err) {
    if (!currentRun.signal.aborted) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    emit({ type: 'done' })
  } finally {
    currentRun = null
  }
})

// ---- Lifecycle ------------------------------------------------------------

app.whenReady().then(async () => {
  await boot()
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  logger?.event('session-end', {})
  logger?.close()
  await mcp.close()
  if (process.platform !== 'darwin') app.quit()
})
