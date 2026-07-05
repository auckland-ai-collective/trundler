import type { Product } from '../../shared/types.js'
import { letterLabel } from '../blocks.js'

interface Props {
  products: Product[]
  provider: string
  query?: string
  canAdd: boolean
  onAdd: (sku: string, provider: string) => void
}

function unitLine(p: Product): string | null {
  if (p.unitPrice == null || !p.unitMeasure) return null
  return `$${p.unitPrice.toFixed(2)} / ${p.unitMeasure}`
}

export function ProductGrid({ products, provider, query, canAdd, onAdd }: Props): JSX.Element {
  return (
    <div className="products">
      <div className="products-head">
        {query ? `“${query}” · ` : ''}
        {products.length} item{products.length === 1 ? '' : 's'} · {provider}
      </div>
      <div className="product-grid">
        {products.map((p, i) => (
          <div className="product-card" key={`${p.sku}-${i}`}>
            <div className="product-label">{letterLabel(i)}</div>
            {p.image ? (
              <img className="product-img" src={p.image} alt="" loading="lazy" />
            ) : (
              <div className="product-img placeholder" />
            )}
            <div className="product-body">
              <div className="product-name" title={p.name}>
                {p.name}
              </div>
              {p.size ? <div className="product-size">{p.size}</div> : null}
              <div className="product-prices">
                {p.price != null ? <span className="price">${p.price.toFixed(2)}</span> : null}
                {p.isSpecial && p.originalPrice != null ? (
                  <span className="was">${p.originalPrice.toFixed(2)}</span>
                ) : null}
                {unitLine(p) ? <span className="unit">{unitLine(p)}</span> : null}
              </div>
              {p.multiBuy ? <div className="multibuy">{p.multiBuy}</div> : null}
              <div className="product-actions">
                {p.productUrl ? (
                  <a className="link" href={p.productUrl} target="_blank" rel="noreferrer">
                    view
                  </a>
                ) : null}
                {canAdd ? (
                  <button className="add-btn" onClick={() => onAdd(p.sku, provider)}>
                    + add
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
