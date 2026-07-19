import { useState } from 'react'
import type { Cart, CartItem } from '../../shared/types.js'
import { countdownImage, upsizeImage } from '../blocks.js'
import { Lightbox } from './Lightbox.js'

interface Props {
  cart: Cart | null
  provider: string
  note: string | null
  /** SKU -> image URL, sourced from search grids (cart_get returns no image). */
  images: Record<string, string>
  loading: boolean
  /** A cart mutation is in flight — disable the per-item controls. */
  busy: boolean
  updatedAt: string | null
  onRefresh: () => void
  onRemove: (sku: string, unit: string | undefined, provider: string) => void
  onChangeQty: (sku: string, quantity: number, unit: string | undefined, provider: string) => void
}

function isDetailed(it: CartItem): boolean {
  return Boolean(it && (it.name || it.sku))
}

/**
 * Next quantity for a stepper click. Weight-sold items (unit 'Kg') step by whole
 * kilograms and snap to round values, so a 0.3 Kg produce item lands cleanly on
 * 1 Kg, 2 Kg… rather than an awkward 1.3 Kg — which stores reject for loose
 * produce sold in whole-unit increments, making the button appear to do nothing.
 * 'Each' (and any other unit) keep a simple ±1 step.
 */
function stepQty(qty: number, unit: string | undefined, dir: 1 | -1): number {
  if (unit === 'Kg') return dir === 1 ? Math.floor(qty) + 1 : Math.ceil(qty) - 1
  return qty + dir
}

export function CartPanel({
  cart,
  provider,
  note,
  images,
  loading,
  busy,
  updatedAt,
  onRefresh,
  onRemove,
  onChangeQty
}: Props): JSX.Element {
  const [filter, setFilter] = useState('')
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null)
  const items = cart?.items ?? []
  const totals = cart?.totals ?? {}
  const detailed = items.filter(isDetailed)
  const count = totals.itemCount ?? items.length
  // trundler-mcp may report a count without per-item detail (see cart mapping bug).
  const detailMissing = count > 0 && detailed.length === 0

  const query = filter.trim().toLowerCase()
  const visible = query
    ? detailed.filter((it) => `${it.name ?? ''} ${it.sku ?? ''}`.toLowerCase().includes(query))
    : detailed
  // Only offer the filter once there are enough items for it to be useful.
  const showFilter = detailed.length > 3

  return (
    <>
      <div className="cart-head">
        <span>Cart · {provider}</span>
        <button className="ghost" onClick={onRefresh} title="Refresh cart" disabled={loading}>
          {loading ? '…' : '⟳'}
        </button>
      </div>

      {updatedAt ? <div className="cart-updated">updated {updatedAt}</div> : null}
      {note ? <div className="cart-note">{note}</div> : null}

      {showFilter ? (
        <div className="cart-filter">
          <input
            type="text"
            className="cart-filter-input"
            placeholder="Filter items…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter cart items"
          />
          {filter ? (
            <button
              className="cart-filter-clear"
              title="Clear filter"
              aria-label="Clear filter"
              onClick={() => setFilter('')}
            >
              ×
            </button>
          ) : null}
        </div>
      ) : null}

      {cart == null ? (
        <div className="cart-empty">Refresh to load your cart.</div>
      ) : count === 0 ? (
        <div className="cart-empty">No items yet.</div>
      ) : detailMissing ? (
        <div className="cart-note">
          {count} item{count === 1 ? '' : 's'} in cart. Per-item detail isn’t available from the
          provider yet — check totals below.
        </div>
      ) : visible.length === 0 ? (
        <div className="cart-empty">No items match “{filter.trim()}”.</div>
      ) : (
        <ul className="cart-items">
          {visible.map((it, i) => {
            const qty = it.quantity ?? 1
            const unitLabel = it.unit && it.unit !== 'Each' ? ` ${it.unit}` : ''
            // Prefer an image seen in a search grid; otherwise derive it from the
            // stockcode (Countdown only — other providers' URLs aren't derivable).
            const img =
              (it.sku ? images[it.sku] : undefined) ??
              (it.sku && provider === 'countdown' ? countdownImage(it.sku) : undefined)
            const label = it.name ?? it.sku
            return (
              <li key={`${it.sku ?? 'x'}-${i}`} className="cart-item">
                <div className="cart-item-top">
                  {img ? (
                    <img
                      className="cart-thumb"
                      src={img}
                      alt=""
                      loading="lazy"
                      title="Click to enlarge"
                      onClick={() => setZoom({ src: upsizeImage(img), name: label })}
                      // A derived URL may 404 (item has no image) — hide it rather
                      // than show a broken-image icon.
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : null}
                  <div className="cart-item-name">{label}</div>
                  <button
                    className="cart-item-remove"
                    title="Remove from cart"
                    aria-label={`Remove ${it.name ?? it.sku} from cart`}
                    disabled={busy}
                    onClick={() => onRemove(it.sku, it.unit, provider)}
                  >
                    ×
                  </button>
                </div>
                <div className="cart-item-meta">
                  <div className="qty-stepper">
                    <button
                      title="Decrease quantity"
                      aria-label="Decrease quantity"
                      disabled={busy}
                      onClick={() => onChangeQty(it.sku, stepQty(qty, it.unit, -1), it.unit, provider)}
                    >
                      −
                    </button>
                    <span className="qty-value">
                      {qty}
                      {unitLabel}
                    </span>
                    <button
                      title="Increase quantity"
                      aria-label="Increase quantity"
                      disabled={busy}
                      onClick={() => onChangeQty(it.sku, stepQty(qty, it.unit, 1), it.unit, provider)}
                    >
                      +
                    </button>
                  </div>
                  {it.subtotal != null ? <span>{formatMoney(it.subtotal)}</span> : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {cart && count > 0 ? (
        <div className="cart-totals">
          <div className="cart-total-row">
            <span>Items</span>
            <span>{count}</span>
          </div>
          {totals.savings ? (
            <div className="cart-total-row saving">
              <span>Savings</span>
              <span>{totals.savings}</span>
            </div>
          ) : null}
          <div className="cart-total-row grand">
            <span>Total</span>
            <span>{totals.total ?? totals.subtotal ?? '—'}</span>
          </div>
        </div>
      ) : null}

      {zoom ? (
        <Lightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />
      ) : null}
    </>
  )
}

function formatMoney(v: string | number): string {
  if (typeof v === 'number') return `$${v.toFixed(2)}`
  return v.startsWith('$') ? v : `$${v}`
}
