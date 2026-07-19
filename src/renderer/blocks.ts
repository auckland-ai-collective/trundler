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

export type ProductSort = 'unit' | 'default'

/**
 * Order products for display. 'unit' sorts by price-per-unit ascending
 * (cheapest value first); items with no unit price sink to the bottom while
 * keeping their original relative order. 'default' preserves the provider's
 * order (usually search relevance). Stable, and never mutates the input.
 */
export function sortProducts(products: Product[], mode: ProductSort): Product[] {
  if (mode === 'default') return products
  return products
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const av = a.p.unitPrice
      const bv = b.p.unitPrice
      if (av == null && bv == null) return a.i - b.i
      if (av == null) return 1
      if (bv == null) return -1
      return av - bv || a.i - b.i
    })
    .map((x) => x.p)
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
