import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { TrundlerMcp } from './mcpClient.js'
import { OllamaBackend } from './agent/ollamaBackend.js'
import { AnthropicBackend } from './agent/anthropicBackend.js'
import { runAgent } from './agent/loop.js'
import { buildSystemPrompt } from './agent/system.js'
import type { Backend, ChatMessage } from './agent/types.js'
import type { AgentEvent, AppConfig, ToolCall } from '../shared/types.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

let mainWindow: BrowserWindow | null = null
const mcp = new TrundlerMcp()
let config: AppConfig = { backend: 'ollama' } as AppConfig
let history: ChatMessage[] = []
let systemPrompt = ''
let currentRun: AbortController | null = null
const pendingApprovals = new Map<string, (approved: boolean) => void>()

function emit(evt: AgentEvent): void {
  mainWindow?.webContents.send('agent:event', evt)
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
  try {
    await mcp.connect(config.mcpServerPath, process.execPath)
    systemPrompt = buildSystemPrompt(mcp.instructions, config.defaultProvider)
    console.log(`[trundler] MCP connected, ${mcp.getTools().length} tools`)
  } catch (err) {
    console.error('[trundler] MCP connection failed:', err)
  }
}

// ---- IPC ------------------------------------------------------------------

ipcMain.handle('config:get', () => config)

ipcMain.handle('config:set', (_e, next: AppConfig) => {
  config = next
  saveConfig(config)
  systemPrompt = buildSystemPrompt(mcp.instructions, config.defaultProvider)
  return config
})

ipcMain.handle('tools:list', () =>
  mcp.getTools().map((t) => ({ name: t.name, description: t.description }))
)

ipcMain.handle('chat:reset', () => {
  history = []
  return true
})

/** Direct, user-initiated MCP call (cart panel refresh, add button, store setup). */
ipcMain.handle('mcp:call', async (_e, name: string, args: Record<string, unknown>) => {
  try {
    return { ok: true, data: await mcp.callTool(name, args ?? {}) }
  } catch (err) {
    return { ok: false, data: { error: err instanceof Error ? err.message : String(err) } }
  }
})

ipcMain.handle('approval:respond', (_e, id: string, approved: boolean) => {
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
  await mcp.close()
  if (process.platform !== 'darwin') app.quit()
})
