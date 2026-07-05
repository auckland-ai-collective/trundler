// Types shared across the main process, preload bridge, and renderer.

export type BackendId = 'ollama' | 'anthropic'

export interface AppConfig {
  backend: BackendId
  ollama: { baseUrl: string; model: string }
  anthropic: { apiKey: string; model: string }
  /** Absolute path to the built trundler-mcp entry (dist/index.js). */
  mcpServerPath: string
  /** Default grocery provider the agent should assume. */
  defaultProvider: string
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** A product as returned by trundler-mcp product tools. */
export interface Product {
  sku: string
  name: string
  brand?: string
  price?: number
  originalPrice?: number
  savings?: number
  savingsPercent?: number
  isSpecial?: boolean
  multiBuy?: string | null
  unitPrice?: number
  unitMeasure?: string
  size?: string
  inStock?: boolean
  image?: string
  productUrl?: string
  department?: string
}

export interface CartItem {
  sku: string
  name?: string
  quantity?: number
  unit?: string
  price?: number
  subtotal?: string | number
}

export interface CartTotals {
  itemCount?: number
  totalQuantity?: number
  subtotal?: string
  savings?: string
  total?: string
}

export interface Cart {
  items: CartItem[]
  totals: CartTotals
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
