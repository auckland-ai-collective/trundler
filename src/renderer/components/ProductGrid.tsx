import { useMemo, useState } from 'react'
import type { Product } from '../../shared/types.js'
import { letterLabel, sortProducts, unitPriceLabel, upsizeImage, type ProductSort } from '../blocks.js'
import { Lightbox } from './Lightbox.js'

/** "Save $2.00 (20%)" from whichever of the two the provider gave us. Null when
 *  neither is a positive number, so specials without a stated saving stay clean. */
function savingsLabel(savings?: number, percent?: number): string | null {
  const hasDollar = typeof savings === 'number' && savings > 0
  const hasPercent = typeof percent === 'number' && percent > 0
  if (hasDollar && hasPercent) return `Save $${savings.toFixed(2)} (${Math.round(percent)}%)`
  if (hasDollar) return `Save $${savings.toFixed(2)}`
  if (hasPercent) return `Save ${Math.round(percent)}%`
  return null
}

interface Props {
  products: Product[]
  provider: string
  query?: string
  canAdd: boolean
  onAdd: (sku: string, provider: string) => void
  /** "provider:sku" keys of favorited items — controls the filled heart. */
  favoriteKeys: Set<string>
  onToggleFavorite: (product: Product, provider: string) => void
}

export function ProductGrid({
  products,
  provider,
  query,
  canAdd,
  onAdd,
  favoriteKeys,
  onToggleFavorite
}: Props): JSX.Element {
  // Default to cheapest-per-unit first; the toggle restores provider order.
  const [sort, setSort] = useState<ProductSort>('unit')
  const [zoom, setZoom] = useState<Product | null>(null)
  const canSortByUnit = useMemo(() => products.some((p) => p.unitPrice != null), [products])
  const ordered = useMemo(() => sortProducts(products, sort), [products, sort])

  return (
    <div className="products">
      <div className="products-head">
        <span>
          {query ? `“${query}” · ` : ''}
          {products.length} item{products.length === 1 ? '' : 's'} · {provider}
        </span>
        {canSortByUnit ? (
          <button
            className="sort-toggle"
            title={
              sort === 'unit'
                ? 'Sorted by price per unit (lowest first) — click for provider order'
                : 'Provider order — click to sort by price per unit'
            }
            onClick={() => setSort((s) => (s === 'unit' ? 'default' : 'unit'))}
          >
            {sort === 'unit' ? '↑ per unit' : '≡ default'}
          </button>
        ) : null}
      </div>
      <div className="product-grid">
        {ordered.map((p, i) => {
          const unit = unitPriceLabel(p)
          // Only an explicit `false` means out of stock; `undefined` = unknown
          // (some providers don't report availability) and stays purchasable.
          const outOfStock = p.inStock === false
          // Green price + "was" + savings only for genuine specials, so green
          // reliably signals a deal rather than colouring every price.
          const onSpecial = p.isSpecial === true
          const savingsText = onSpecial ? savingsLabel(p.savings, p.savingsPercent) : null
          const showWas =
            onSpecial && p.originalPrice != null && p.price != null && p.originalPrice > p.price
          return (
          <div className={`product-card${outOfStock ? ' oos' : ''}`} key={`${p.sku}-${i}`}>
            <div className="product-label">{letterLabel(i)}</div>
            {outOfStock ? <div className="oos-badge">Out of stock</div> : null}
            {p.image ? (
              <img
                className="product-img"
                src={p.image}
                alt=""
                loading="lazy"
                title="Click to enlarge"
                onClick={() => setZoom(p)}
              />
            ) : (
              <div className="product-img placeholder" />
            )}
            <div className="product-body">
              <div className="product-name" title={p.name}>
                {p.name}
              </div>
              {p.size ? <div className="product-size">{p.size}</div> : null}
              <div className="product-prices">
                {p.price != null ? (
                  <span className={`price${onSpecial ? ' special' : ''}`}>${p.price.toFixed(2)}</span>
                ) : null}
                {showWas ? <span className="was">${p.originalPrice!.toFixed(2)}</span> : null}
                {unit ? <span className="unit">{unit}</span> : null}
              </div>
              {savingsText ? <div className="savings">{savingsText}</div> : null}
              {p.multiBuy ? <div className="multibuy">{p.multiBuy}</div> : null}
              <div className="product-actions">
                {p.productUrl ? (
                  <a className="link" href={p.productUrl} target="_blank" rel="noreferrer">
                    view
                  </a>
                ) : null}
                <div className="product-actions-right">
                  {p.sku ? (
                    <button
                      className={`fav-btn${favoriteKeys.has(`${provider}:${p.sku}`) ? ' on' : ''}`}
                      title={
                        favoriteKeys.has(`${provider}:${p.sku}`)
                          ? 'Remove from favorites'
                          : 'Add to favorites'
                      }
                      aria-label={
                        favoriteKeys.has(`${provider}:${p.sku}`)
                          ? 'Remove from favorites'
                          : 'Add to favorites'
                      }
                      aria-pressed={favoriteKeys.has(`${provider}:${p.sku}`)}
                      onClick={() => onToggleFavorite(p, provider)}
                    >
                      {favoriteKeys.has(`${provider}:${p.sku}`) ? '♥' : '♡'}
                    </button>
                  ) : null}
                  {canAdd ? (
                    <button
                      className="add-btn"
                      disabled={outOfStock}
                      title={outOfStock ? 'Out of stock' : undefined}
                      onClick={() => onAdd(p.sku, provider)}
                    >
                      + add
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          )
        })}
      </div>
      {zoom?.image ? (
        <Lightbox
          src={upsizeImage(zoom.image)}
          alt={zoom.name}
          caption={zoom.name}
          onClose={() => setZoom(null)}
        />
      ) : null}
    </div>
  )
}
