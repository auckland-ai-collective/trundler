import type { Product } from '../shared/types.js'

export type Block =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string }
  | { kind: 'tool'; id: string; name: string; args: Record<string, unknown>; status: 'running' | 'ok' | 'error' }
  | { kind: 'products'; id: string; provider: string; query?: string; products: Product[] }
  | { kind: 'error'; id: string; text: string }

/** Tool names whose results should render as a product grid. */
export const PRODUCT_TOOLS = new Set([
  'search_products',
  'get_specials',
  'browse_products',
  'list_past_order_items',
  'get_order_items'
])

export const CART_TOOLS = new Set(['cart_get', 'cart_add', 'cart_update', 'cart_remove'])

/** Pull a product array out of a tool result of unknown shape. */
export function extractProducts(data: unknown): Product[] | null {
  if (!data || typeof data !== 'object') return null
  const obj = data as Record<string, unknown>
  if (Array.isArray(obj.products)) return obj.products as Product[]
  if (Array.isArray(obj.items) && obj.items.length && (obj.items[0] as Product).sku) {
    return obj.items as Product[]
  }
  return null
}

/** Assign stable A, B, C … AA, AB labels to products for easy quantity-picking. */
export function letterLabel(i: number): string {
  let n = i
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}
