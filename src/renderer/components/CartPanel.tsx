import type { Cart } from '../../shared/types.js'

interface Props {
  cart: Cart | null
  provider: string
  note: string | null
  onRefresh: () => void
}

export function CartPanel({ cart, provider, note, onRefresh }: Props): JSX.Element {
  const items = cart?.items ?? []
  const totals = cart?.totals ?? {}

  return (
    <aside className="cart-panel">
      <div className="cart-head">
        <span>Cart · {provider}</span>
        <button className="ghost" onClick={onRefresh} title="Refresh cart">
          ⟳
        </button>
      </div>

      {note ? <div className="cart-note">{note}</div> : null}

      {items.length === 0 ? (
        <div className="cart-empty">No items yet.</div>
      ) : (
        <ul className="cart-items">
          {items.map((it, i) => (
            <li key={`${it.sku}-${i}`} className="cart-item">
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

      {cart ? (
        <div className="cart-totals">
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
