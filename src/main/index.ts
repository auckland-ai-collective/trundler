import { app, BrowserWindow, ipcMain, shell, Menu, nativeTheme } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadConfig, saveConfig } from './config.js'
import { TrundlerMcp } from './mcpClient.js'
import { OllamaBackend } from './agent/ollamaBackend.js'
import { AnthropicBackend } from './agent/anthropicBackend.js'
import { runAgent, MUTATING_TOOLS } from './agent/loop.js'
import {
  ClaudeCodeBridge,
  writeClaudeCodeWorkspace,
  type ClaudeCodeWorkspace
} from './agent/claudeCodeBridge.js'
import { runClaudeCode, detectClaudeCode, type ClaudeCodeSession } from './agent/claudeCodeAgent.js'
import { listOllamaModels } from './ollamaModels.js'
import { buildSystemPrompt, favoritesPromptSection } from './agent/system.js'
import { loadFavorites, toggleFavorite, removeFavorite } from './favorites.js'
import { Logger, forcedDebug } from './logger.js'
import type { Backend, ChatMessage } from './agent/types.js'
import type { AgentEvent, AppConfig, AuthStatus, Favorite, Product, ToolCall } from '../shared/types.js'

/** Providers that use a login session (others are anonymous / read-only). */
const AUTH_PROVIDERS = new Set(['countdown'])

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ICON_DIR = join(__dirname, '../../build')
const windowIcon = join(ICON_DIR, process.platform === 'win32' ? 'icon.ico' : 'icon.png')

let mainWindow: BrowserWindow | null = null
const mcp = new TrundlerMcp()
let config: AppConfig = { backend: 'ollama' } as AppConfig
let history: ChatMessage[] = []
let favorites: Favorite[] = []
let systemPrompt = ''
let currentRun: AbortController | null = null
let logger: Logger
let assistantBuf = ''
const pendingApprovals = new Map<string, (approved: boolean) => void>()

/** The Claude Code CLI's conversation, so follow-up messages `--resume` it
 *  rather than starting over. Cleared whenever the thread no longer applies. */
const claudeSession: ClaudeCodeSession = { id: null }

/** Serialises approval prompts. The app's own loop calls tools one at a time,
 *  but the CLI can fire several at once — and the UI shows a single modal, so a
 *  second request would silently replace the first and leave it unanswered. */
let approvalQueue: Promise<unknown> = Promise.resolve()

function modelInfo(cfg: AppConfig): { backend: string; model: string } {
  switch (cfg.backend) {
    case 'anthropic':
      return { backend: 'anthropic', model: cfg.anthropic.model }
    case 'claude-code':
      return { backend: 'claude-code', model: cfg.claudeCode.model }
    default:
      return { backend: 'ollama', model: cfg.ollama.model }
  }
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

/** Ask the user to approve a cart mutation. Auto-approves when the gate is off. */
function requestApproval(call: ToolCall): Promise<boolean> {
  if (!config.requireCartApproval) {
    logger?.event('approval-auto', { name: call.name, args: call.args })
    return Promise.resolve(true)
  }
  // Chain onto the queue so concurrent requests prompt one after another.
  const turn = approvalQueue.then(
    () =>
      new Promise<boolean>((resolve) => {
        pendingApprovals.set(call.id, resolve)
        emit({ type: 'approval', id: call.id, call })
      })
  )
  approvalQueue = turn.catch(() => undefined)
  return turn
}

/**
 * Run one tool on the agent's behalf, with the approval gate and the UI events.
 *
 * Shared by the Claude Code bridge and, in spirit, by `runAgent`'s own loop:
 * the CLI executes its tools through here so that a cart change made by Claude
 * Code is gated and surfaced exactly like one made by Ollama.
 */
async function runAgentTool(
  name: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown }> {
  const call: ToolCall = { id: randomUUID(), name, args }
  emit({ type: 'tool-call', call })

  const finish = (ok: boolean, data: unknown): { ok: boolean; data: unknown } => {
    emit({ type: 'tool-result', id: call.id, name, ok, provider: providerOf(call), data })
    return { ok, data }
  }

  if (MUTATING_TOOLS.has(name) && !(await requestApproval(call))) {
    return finish(false, { error: 'The user declined this action.' })
  }

  try {
    const data = await mcp.callTool(name, args)
    const ok = !(data && typeof data === 'object' && 'error' in (data as object))
    return finish(ok, data)
  } catch (err) {
    return finish(false, { error: err instanceof Error ? err.message : String(err) })
  }
}

/** Loopback MCP proxy endpoint for the Claude Code CLI. Started on first use. */
const claudeBridge = new ClaudeCodeBridge({
  listTools: () => mcp.getTools(),
  callTool: runAgentTool
})

/**
 * Prepare a Claude Code run: bring the bridge up and write its config files.
 *
 * Done per message because the bridge's port and token are per-process and the
 * system prompt changes with the provider and the favorites list.
 */
async function prepareClaudeCode(prompt: string): Promise<ClaudeCodeWorkspace> {
  const address = await claudeBridge.start()
  return writeClaudeCodeWorkspace(app.getPath('userData'), address, prompt, process.execPath)
}

/** Drop the CLI conversation so the next message starts a new one. */
function resetClaudeSession(reason: string): void {
  if (!claudeSession.id) return
  logger?.event('claude-code-session-end', { reason, sessionId: claudeSession.id })
  claudeSession.id = null
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#14161b',
    title: `Trundler v${app.getVersion()}`,
    icon: windowIcon,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Keep our versioned title — don't let the page's <title> override it.
  mainWindow.on('page-title-updated', (e) => e.preventDefault())

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
  favorites = loadFavorites()
  logger = new Logger(config.debugLogging || forcedDebug())
  try {
    await mcp.connect(config.mcpServerPath, process.execPath)
    systemPrompt = buildSystemPrompt(mcp.instructions, config.defaultProvider)
    console.log(`[trundler] MCP connected, ${mcp.getTools().length} tools`)
    logger.event('session-start', {
      appVersion: app.getVersion(),
      ...modelInfo(config),
      provider: config.defaultProvider,
      mcpServerPath: config.mcpServerPath,
      mcpVersion: mcp.serverInfo?.version,
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

  // Apply the debug-logging setting (a CLI flag / env can still force it on).
  const wasEnabled = logger?.enabled
  logger?.setEnabled(config.debugLogging || forcedDebug())
  if (logger?.enabled && !wasEnabled) {
    logger.event('logging-enabled', { appVersion: app.getVersion(), ...modelInfo(config) })
  }

  const after = modelInfo(config)
  if (before.backend !== after.backend || before.model !== after.model) {
    logger?.event('backend-change', { from: before, to: after, provider: config.defaultProvider })
    // The CLI's transcript is its own and can't be handed to another brain (nor
    // picked back up mid-thread under a different model), so retire it. The
    // app's `history` still holds the conversation for the other backends.
    resetClaudeSession('backend-change')
  }
  return config
})

ipcMain.handle('favorites:get', () => favorites)
ipcMain.handle('favorites:toggle', (_e, provider: string, product: Product) => {
  favorites = toggleFavorite(favorites, provider, product)
  return favorites
})
ipcMain.handle('favorites:remove', (_e, provider: string, sku: string) => {
  favorites = removeFavorite(favorites, provider, sku)
  return favorites
})

ipcMain.handle('debug:info', () => logger?.info() ?? { enabled: false, path: '' })
ipcMain.handle('debug:open', () => logger?.openFolder())

ipcMain.handle('tools:list', () =>
  mcp.getTools().map((t) => ({ name: t.name, description: t.description }))
)

/** Discover local Ollama models + tool-calling capability for the model picker. */
ipcMain.handle('ollama:models', (_e, baseUrl?: string) =>
  listOllamaModels(baseUrl || config.ollama.baseUrl)
)

/** Is the local Claude Code CLI installed? Cheap probe for the settings UI. */
ipcMain.handle('claudeCode:status', (_e, command?: string) =>
  detectClaudeCode(command || config.claudeCode.command)
)

ipcMain.handle('chat:reset', () => {
  history = []
  assistantBuf = ''
  resetClaudeSession('new-chat')
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

// ---- Auth -----------------------------------------------------------------

async function getAuthStatus(provider: string): Promise<AuthStatus> {
  if (!AUTH_PROVIDERS.has(provider)) {
    return { provider, requiresLogin: false, isLoggedIn: false, email: null, expiresAt: null }
  }
  try {
    const data = (await mcp.callTool('check_login', { provider })) as {
      isLoggedIn?: boolean
      email?: string | null
      expiresAt?: string | null
    }
    return {
      provider,
      requiresLogin: true,
      isLoggedIn: Boolean(data?.isLoggedIn),
      email: data?.email ?? null,
      expiresAt: data?.expiresAt ?? null
    }
  } catch {
    return { provider, requiresLogin: true, isLoggedIn: false, email: null, expiresAt: null }
  }
}

ipcMain.handle('auth:status', (_e, provider: string) => getAuthStatus(provider))

ipcMain.handle('auth:login', async (_e, provider: string) => {
  logger?.event('auth-login-start', { provider })
  let loginError: string | null = null
  try {
    // trundler returns tool failures as a normal result with an `error` field
    // (not a thrown exception), so inspect the result rather than only catching.
    const result = await mcp.callTool('login', { provider }) // opens a browser; blocks until done
    if (result && typeof result === 'object' && 'error' in (result as object)) {
      loginError = String((result as { error: unknown }).error)
    }
  } catch (err) {
    loginError = err instanceof Error ? err.message : String(err)
  }
  if (loginError) logger?.event('auth-login-error', { provider, error: loginError })
  const status = await getAuthStatus(provider)
  logger?.event('auth-login-done', {
    provider,
    isLoggedIn: status.isLoggedIn,
    email: status.email,
    error: loginError
  })
  return { ...status, error: loginError }
})

ipcMain.handle('auth:logout', async (_e, provider: string) => {
  logger?.event('auth-logout', { provider })
  try {
    // Lazily import so the package's Playwright-laden graph stays out of startup.
    const { TokenStore } = await import('@auckland-ai-collective/trundler-mcp')
    // Clear on-disk session, then respawn so the server drops its cached tokens.
    await new TokenStore(provider).clear()
    await mcp.reconnect()
    systemPrompt = buildSystemPrompt(mcp.instructions, config.defaultProvider)
  } catch (err) {
    logger?.event('auth-logout-error', { provider, error: err instanceof Error ? err.message : String(err) })
  }
  return getAuthStatus(provider)
})

ipcMain.handle('chat:cancel', () => {
  currentRun?.abort()
})

/**
 * Hand one message to the Claude Code CLI.
 *
 * The CLI runs the agent loop itself, so there is no `runAgent` here: tool
 * calls arrive as HTTP requests on the bridge and are emitted from
 * `runAgentTool`. All this does is stream the prose and keep `history` honest,
 * so switching back to another brain mid-conversation still has the thread.
 */
async function sendViaClaudeCode(text: string, prompt: string): Promise<void> {
  let reply = ''
  try {
    const workspace = await prepareClaudeCode(claudeCodePrompt(prompt))
    await runClaudeCode({
      command: config.claudeCode.command,
      model: config.claudeCode.model,
      prompt: text,
      workspace,
      session: claudeSession,
      onText: (delta) => {
        reply += delta
        emit({ type: 'text', delta })
      },
      onDebug: (message, detail) => logger?.event(message, detail ?? {}),
      signal: currentRun!.signal
    })
    if (reply.trim()) history.push({ role: 'assistant', content: reply, toolCalls: [] })
    emit({ type: 'done' })
  } catch (err) {
    if (!currentRun?.signal.aborted) {
      emit({ type: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    emit({ type: 'done' })
  } finally {
    currentRun = null
  }
}

/**
 * The system prompt, plus what the CLI route specifically needs to know.
 *
 * Tools reach it through an MCP proxy, so their names carry a server prefix —
 * without saying so, the model is being shown `mcp__trundler__search_products`
 * while the prompt talks about `search_products`, and it tends to hedge about
 * whether it has the tool at all. The rest keeps a coding agent from behaving
 * like one: it has no file or shell tools here, and saying so up front stops it
 * proposing to go and look at something.
 */
function claudeCodePrompt(prompt: string): string {
  return [
    prompt,
    '',
    '--- How your tools are wired ---',
    'Your grocery tools are provided over MCP and so their names appear with an',
    '"mcp__trundler__" prefix — e.g. `mcp__trundler__search_products` is the',
    '`search_products` tool described above. Treat the two names as the same tool.',
    'These are the only tools you have: there is no file access, no shell, and no',
    'web search, so never offer to look something up outside the trundler tools.',
    'You are talking to a shopper in a chat window, not working in a terminal:',
    'reply in prose, never report on your own progress, and do not describe files,',
    'commands, or code.'
  ].join('\n')
}

ipcMain.handle('chat:send', async (_e, text: string) => {
  if (!mcp.getTools().length) {
    emit({ type: 'error', message: 'MCP is not connected. Check the server path in Settings.' })
    emit({ type: 'done' })
    return
  }

  history.push({ role: 'user', content: text })
  currentRun = new AbortController()
  logger?.event('user-message', { text, ...modelInfo(config), provider: config.defaultProvider })

  // Append the current favorites so the agent can act on "my favorites" without
  // a lookup. Built per-send so it always reflects the live list.
  const favSection = favoritesPromptSection(favorites)
  const prompt = favSection ? `${systemPrompt}\n\n${favSection}` : systemPrompt

  if (config.backend === 'claude-code') {
    await sendViaClaudeCode(text, prompt)
    return
  }

  const backend = makeBackend(config)

  try {
    await runAgent(
      backend,
      prompt,
      history,
      mcp.getTools(),
      {
        onText: (delta) => emit({ type: 'text', delta }),
        onToolCall: (call) => emit({ type: 'tool-call', call }),
        onToolResult: (call, ok, data) =>
          emit({ type: 'tool-result', id: call.id, name: call.name, ok, provider: providerOf(call), data }),
        callTool: (name, args) => mcp.callTool(name, args),
        requestApproval
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
  nativeTheme.themeSource = 'dark' // dark native title bar + window frame (DWM)
  Menu.setApplicationMenu(null) // no default File/Edit/View… menu bar
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(join(ICON_DIR, 'icon.png')) // dock icon in dev (packaged uses icns)
  }
  await boot()
  await createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', async () => {
  logger?.event('session-end', {})
  logger?.close()
  currentRun?.abort() // takes any in-flight CLI child down with it
  await claudeBridge.stop()
  await mcp.close()
  if (process.platform !== 'darwin') app.quit()
})
