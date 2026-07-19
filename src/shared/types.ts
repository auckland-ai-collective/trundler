// Types shared across the main process, preload bridge, and renderer.

// Grocery domain types come from the MCP package — single source of truth.
// Type-only re-export: erased at compile time, so it never pulls the package
// (or its Playwright graph) into the renderer bundle.
import type { Product } from '@auckland-ai-collective/trundler-mcp'
export type { Product, Cart, CartItem, CartTotals } from '@auckland-ai-collective/trundler-mcp'

/** A product the user has favorited — a full snapshot (so the favorites view
 *  needs no live lookup) plus which provider it came from and when it was saved. */
export type Favorite = Product & { provider: string; addedAt: string }

export type BackendId = 'ollama' | 'anthropic'

export interface AppConfig {
  backend: BackendId
  ollama: { baseUrl: string; model: string }
  anthropic: { apiKey: string; model: string }
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
