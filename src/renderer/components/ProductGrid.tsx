import { useMemo, useState } from 'react'
import type { Product } from '../../shared/types.js'
import { letterLabel, sortProducts, unitPriceLabel, upsizeImage, type ProductSort } from '../blocks.js'
import { Lightbox } from './Lightbox.js'

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
          return (
          <div className="product-card" key={`${p.sku}-${i}`}>
            <div className="product-label">{letterLabel(i)}</div>
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
                {p.price != null ? <span className="price">${p.price.toFixed(2)}</span> : null}
                {p.isSpecial && p.originalPrice != null ? (
                  <span className="was">${p.originalPrice.toFixed(2)}</span>
                ) : null}
                {unit ? <span className="unit">{unit}</span> : null}
              </div>
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
                    <button className="add-btn" onClick={() => onAdd(p.sku, provider)}>
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
