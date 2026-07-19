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
 * A product's unit price normalised to a canonical measure so items quoted in
 * different units can be compared. The provider gives `unitPrice` against a
 * per-product `unitMeasure` (e.g. "100g", "1kg", "100mL", "ea"), so a raw
 * `unitPrice` comparison is meaningless ($3.89/100g looks cheaper than
 * $29.47/1kg but is actually dearer). We reduce each to price-per-kg /
 * price-per-L / price-per-each. `dim` keeps like compared with like (weight vs
 * volume vs count are not interchangeable) when a result set mixes measures.
 */
interface NormalizedUnit {
  /** Price per canonical unit (per kg, per L, or per each). */
  value: number
  /** Canonical measure label for display: 'kg' | 'L' | 'ea'. */
  label: string
  /** Dimension rank — weight < volume < count — to avoid cross-comparison. */
  dim: number
}

const DIM_WEIGHT = 0
const DIM_VOLUME = 1
const DIM_COUNT = 2

export function normalizedUnit(p: Product): NormalizedUnit | null {
  if (p.unitPrice == null || !p.unitMeasure) return null
  const m = p.unitMeasure.trim().toLowerCase().match(/^([\d.]*)\s*([a-z]+)$/)
  if (!m) return null
  const qty = m[1] ? parseFloat(m[1]) : 1
  if (!(qty > 0)) return null
  const perRaw = p.unitPrice / qty // price for one of the raw unit (per g, per mL, per ea)
  switch (m[2]) {
    case 'mg':
      return { value: perRaw * 1_000_000, label: 'kg', dim: DIM_WEIGHT }
    case 'g':
      return { value: perRaw * 1000, label: 'kg', dim: DIM_WEIGHT }
    case 'kg':
      return { value: perRaw, label: 'kg', dim: DIM_WEIGHT }
    case 'ml':
      return { value: perRaw * 1000, label: 'L', dim: DIM_VOLUME }
    case 'l':
      return { value: perRaw, label: 'L', dim: DIM_VOLUME }
    case 'ea':
    case 'each':
    case 'pk':
    case 'ct':
      return { value: perRaw, label: 'ea', dim: DIM_COUNT }
    default:
      return null
  }
}

/** Normalised per-unit price line for display, e.g. "$38.90 / kg". */
export function unitPriceLabel(p: Product): string | null {
  const n = normalizedUnit(p)
  if (n) return `$${n.value.toFixed(2)} / ${n.label}`
  // Fall back to the provider's raw quote rather than hiding the info.
  if (p.unitPrice != null && p.unitMeasure) return `$${p.unitPrice.toFixed(2)} / ${p.unitMeasure}`
  return null
}

/**
 * Order products for display. 'unit' sorts by normalised price-per-unit
 * ascending (cheapest value first), grouping by dimension so weight/volume/count
 * items aren't numerically interleaved; items with no unit price sink to the
 * bottom while keeping their original relative order. 'default' preserves the
 * provider's order (usually search relevance). Stable, never mutates the input.
 */
export function sortProducts(products: Product[], mode: ProductSort): Product[] {
  if (mode === 'default') return products
  return products
    .map((p, i) => ({ p, i, n: normalizedUnit(p) }))
    .sort((a, b) => {
      if (!a.n && !b.n) return a.i - b.i
      if (!a.n) return 1
      if (!b.n) return -1
      return a.n.dim - b.n.dim || a.n.value - b.n.value || a.i - b.i
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
