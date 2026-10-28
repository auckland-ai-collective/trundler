// Types shared across the main process, preload bridge, and renderer.

// Grocery domain types come from the MCP package — single source of truth.
// Type-only re-export: erased at compile time, so it never pulls the package
// (or its Playwright graph) into the renderer bundle.
import type { Product } from '@auckland-ai-collective/trundler-mcp'
export type { Product, Cart, CartItem, CartTotals } from '@auckland-ai-collective/trundler-mcp'

/** A product the user has favorited — a full snapshot (so the favorites view
 *  needs no live lookup) plus which provider it came from and when it was saved. */
export type Favorite = Product & { provider: string; addedAt: string }

export type BackendId = 'ollama' | 'anthropic' | 'claude-code'

export interface AppConfig {
  backend: BackendId
  ollama: { baseUrl: string; model: string }
  anthropic: { apiKey: string; model: string }
  /** The local Claude Code CLI as the brain — billed to the user's Claude
   *  subscription, so no API key. `command` is the executable to run. */
  claudeCode: { command: string; model: string }
  /** Absolute path to the built trundler-mcp entry (dist/index.js). */
  mcpServerPath: string
  /** Default grocery provider the agent should assume. */
  defaultProvider: string
  /** Require user approval before cart_add/update/remove (on by default). */
  requireCartApproval: boolean
  /** Write a structured session log for troubleshooting (off by default). */
  debugLogging: boolean
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

// ---- Ollama model discovery ------------------------------------------------

/** A model installed locally in Ollama, with its declared capabilities. */
export interface OllamaModelInfo {
  name: string
  /** On-disk size in bytes (from /api/tags); 0 if unknown. */
  sizeBytes: number
  /** Capability tags from /api/show (e.g. "tools", "vision", "thinking"). */
  capabilities: string[]
  /** Whether the model advertises native tool-calling. */
  supportsTools: boolean
}

/** A tool-capable model we suggest the user pull, if not already installed. */
export interface RecommendedModel {
  name: string
  /** Human-readable download size (approximate). */
  size: string
  /** One-line reason it's worth having. */
  note: string
}

export interface OllamaModelsResult {
  /** False when Ollama couldn't be reached (see `error`). */
  ok: boolean
  error?: string
  installed: OllamaModelInfo[]
  recommended: RecommendedModel[]
}

// ---- Claude Code CLI detection ---------------------------------------------

/** Whether the local `claude` CLI is present and signed in, for the settings UI.
 *  Detection is deliberately cheap (`--version`): it never starts a session, so
 *  it costs nothing against the user's subscription. */
export interface ClaudeCodeStatus {
  /** The CLI ran and reported a version. */
  ok: boolean
  /** The command that was probed (so the UI can show what it tried). */
  command: string
  /** e.g. "2.1.238 (Claude Code)" — whatever `--version` printed. */
  version: string | null
  error?: string
}

/** Model choices offered for the Claude Code backend. These are CLI aliases,
 *  which resolve to the current model in each family — so they don't go stale. */
export interface ClaudeCodeModelOption {
  id: string
  label: string
  note: string
}

// ---- Streaming events pushed from main -> renderer over a single channel ----

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; provider: string; data: unknown }
  | { type: 'approval'; id: string; call: ToolCall }
  | { type: 'done' }
  | { type: 'error'; message: string }

export interface ToolInfo {
  name: string
  description: string
}

export interface AuthStatus {
  provider: string
  /** Whether this provider needs a login at all (false for anonymous providers). */
  requiresLogin: boolean
  isLoggedIn: boolean
  email: string | null
  expiresAt: string | null
  /** Set when the most recent login attempt failed, so the UI can surface it. */
  error?: string | null
}
