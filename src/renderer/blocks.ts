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

/**
 * Countdown/Woolworths product images are served by a resizer where the pixel
 * size is just the `w`/`h` query params, e.g.
 *   https://assets.woolworths.com.au/images/2010/{stockcode}.jpg?impolicy=wowcdxwbjbx&w=200&h=200
 * The path is keyed by stockcode, which is the product/cart `sku` — so any
 * item's image is addressable directly, and any URL can be re-rendered larger.
 */
export function countdownImage(sku: string, size = 200): string {
  return `https://assets.woolworths.com.au/images/2010/${sku}.jpg?impolicy=wowcdxwbjbx&w=${size}&h=${size}`
}

/** Re-render a Woolworths image URL at `size` px by rewriting its w/h query.
 *  URLs without those params (e.g. other providers) are returned unchanged. */
export function upsizeImage(url: string, size = 900): string {
  return url.replace(/([?&][wh]=)\d+/g, (_m, prefix) => `${prefix}${size}`)
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

// ---- Pricing unit (Each vs Kg) ---------------------------------------------

/** The unit a cart line is priced in — mirrors trundler-mcp's `Unit`. */
export type PricingUnit = 'Each' | 'Kg'

/** Short display form of a pricing unit: "kg" / "ea". */
export function unitLabel(unit: PricingUnit): string {
  return unit === 'Kg' ? 'kg' : 'ea'
}

/**
 * Whether a product is priced by weight rather than per item — the shelf price
 * IS the price of one kilogram (loose produce, deli, butchery), so a quantity
 * of "1" means one kilogram, not one pear.
 *
 * The MCP's `Product` carries no explicit pricing unit (the provider's own
 * `unit` / `supportsBothEachAndKgPricing` fields are dropped in its mapping), so
 * infer it from two signals that only line up for weight-sold items:
 *   - `size` reads as a bare weight measure ("kg" / "per kg"), or is absent —
 *     loose produce has no pack size, while anything packaged states one; and
 *   - the normalised price-per-kg equals the shelf price, i.e. buying "one" of
 *     this product costs exactly what a kilogram costs.
 * A packaged 500 g item fails both (size "500g"; per-kg price double the shelf
 * price), and a 1 kg pack is excluded by the stated pack size alone — which is
 * why the size check runs first and is authoritative.
 */
export function soldByWeight(p: Product): boolean {
  const size = (p.size ?? '').trim()
  if (/^(per\s*)?kgs?$/i.test(size)) return true
  // A stated pack size means it's sold as a package, whatever the maths says.
  if (size) return false
  const n = normalizedUnit(p)
  if (!n || n.label !== 'kg' || p.price == null) return false
  return Math.abs(n.value - p.price) < 0.01
}

/** Pricing units offerable for a product, best default first. Weight-sold items
 *  can often also be bought per piece (bananas, avocados), and the provider
 *  doesn't tell us which — so offer both and let the store reject what it won't
 *  take, rather than silently guessing on the user's behalf. */
export function unitOptions(p: Product): PricingUnit[] {
  return soldByWeight(p) ? ['Kg', 'Each'] : ['Each']
}

/** Smallest orderable quantity for a unit. Weight can go sub-kilo; pieces can't. */
function minQty(unit: PricingUnit): number {
  return unit === 'Kg' ? 0.1 : 1
}

/**
 * Next quantity for a stepper click. Weight-sold lines step by whole kilograms
 * and snap to round values, so a 0.3 Kg produce item lands cleanly on 1 Kg,
 * 2 Kg… rather than an awkward 1.3 Kg — which stores reject for loose produce
 * sold in whole-unit increments, making the button appear to do nothing.
 * 'Each' (and any other unit) keep a simple ±1 step.
 */
export function stepQty(qty: number, unit: string | undefined, dir: 1 | -1): number {
  if (unit === 'Kg') return dir === 1 ? Math.floor(qty) + 1 : Math.ceil(qty) - 1
  return qty + dir
}

/** Snap a typed quantity to something the provider will accept: whole pieces,
 *  or weight to 2dp, never below the unit's minimum. */
export function clampQty(qty: number, unit: PricingUnit): number {
  if (unit === 'Kg') return Math.max(minQty(unit), Math.round(qty * 100) / 100)
  return Math.max(minQty(unit), Math.round(qty))
}

/** A quantity for display — trailing zeros trimmed ("1", "1.5", "0.25"). */
export function formatQty(qty: number, unit: PricingUnit): string {
  if (unit !== 'Kg') return String(Math.round(qty))
  return String(Math.round(qty * 100) / 100)
}

/**
 * What `quantity` of `unit` will cost, when that's knowable. For a weight-sold
 * item the shelf price is per kilogram, so kg × price works; buying the same
 * item per piece has no stated price (it's weighed at the store), hence null.
 */
export function estimatedCost(p: Product, qty: number, unit: PricingUnit): number | null {
  if (p.price == null) return null
  if (soldByWeight(p) && unit !== 'Kg') return null
  return p.price * qty
}
