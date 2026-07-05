import type { Cart, CartItem } from '../../shared/types.js'

interface Props {
  cart: Cart | null
  provider: string
  note: string | null
  loading: boolean
  updatedAt: string | null
  onRefresh: () => void
}

function isDetailed(it: CartItem): boolean {
  return Boolean(it && (it.name || it.sku))
}

export function CartPanel({ cart, provider, note, loading, updatedAt, onRefresh }: Props): JSX.Element {
  const items = cart?.items ?? []
  const totals = cart?.totals ?? {}
  const detailed = items.filter(isDetailed)
  const count = totals.itemCount ?? items.length
  // trundler-mcp may report a count without per-item detail (see cart mapping bug).
  const detailMissing = count > 0 && detailed.length === 0

  return (
    <aside className="cart-panel">
      <div className="cart-head">
        <span>Cart · {provider}</span>
        <button className="ghost" onClick={onRefresh} title="Refresh cart" disabled={loading}>
          {loading ? '…' : '⟳'}
        </button>
      </div>

      {updatedAt ? <div className="cart-updated">updated {updatedAt}</div> : null}
      {note ? <div className="cart-note">{note}</div> : null}

      {cart == null ? (
        <div className="cart-empty">Refresh to load your cart.</div>
      ) : count === 0 ? (
        <div className="cart-empty">No items yet.</div>
      ) : detailMissing ? (
        <div className="cart-note">
          {count} item{count === 1 ? '' : 's'} in cart. Per-item detail isn’t available from the
          provider yet — check totals below.
        </div>
      ) : (
        <ul className="cart-items">
          {detailed.map((it, i) => (
            <li key={`${it.sku ?? 'x'}-${i}`} className="cart-item">
              <div className="cart-item-name">{it.name ?? it.sku}</div>
              <div className="cart-item-meta">
                <span>
                  {it.quantity ?? 1}
                  {it.unit && it.unit !== 'Each' ? ` ${it.unit}` : '×'}
                </span>
                {it.subtotal != null ? <span>{formatMoney(it.subtotal)}</span> : null}
              </div>
            </li>
          ))}
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
    </aside>
  )
}

function formatMoney(v: string | number): string {
  if (typeof v === 'number') return `$${v.toFixed(2)}`
  return v.startsWith('$') ? v : `$${v}`
}
