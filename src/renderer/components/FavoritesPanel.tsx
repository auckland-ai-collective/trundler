import { useState } from 'react'
import type { Favorite } from '../../shared/types.js'
import { upsizeImage } from '../blocks.js'
import { Lightbox } from './Lightbox.js'

interface Props {
  favorites: Favorite[]
  /** The active provider — favorites from it can be added to the cart directly. */
  provider: string
  canAdd: boolean
  onAdd: (sku: string, provider: string) => void
  onRemoveFavorite: (provider: string, sku: string) => void
}

export function FavoritesPanel({
  favorites,
  provider,
  canAdd,
  onAdd,
  onRemoveFavorite
}: Props): JSX.Element {
  const [filter, setFilter] = useState('')
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null)

  const query = filter.trim().toLowerCase()
  const visible = query
    ? favorites.filter((f) => `${f.name ?? ''} ${f.sku ?? ''}`.toLowerCase().includes(query))
    : favorites
  const showFilter = favorites.length > 3

  return (
    <>
      <div className="cart-head">
        <span>Favorites</span>
        <span className="cart-updated">
          {favorites.length} item{favorites.length === 1 ? '' : 's'}
        </span>
      </div>

      {showFilter ? (
        <div className="cart-filter">
          <input
            type="text"
            className="cart-filter-input"
            placeholder="Filter favorites…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter favorites"
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

      {favorites.length === 0 ? (
        <div className="cart-empty">
          No favorites yet. Tap the ♡ on a product to save it here.
        </div>
      ) : visible.length === 0 ? (
        <div className="cart-empty">No favorites match “{filter.trim()}”.</div>
      ) : (
        <ul className="cart-items">
          {visible.map((f) => {
            const addable = canAdd && f.provider === provider
            return (
              <li key={`${f.provider}-${f.sku}`} className="cart-item">
                <div className="cart-item-top">
                  {f.image ? (
                    <img
                      className="cart-thumb"
                      src={f.image}
                      alt=""
                      loading="lazy"
                      title="Click to enlarge"
                      onClick={() => setZoom({ src: upsizeImage(f.image as string), name: f.name })}
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                      }}
                    />
                  ) : null}
                  <div className="cart-item-name">{f.name ?? f.sku}</div>
                  <button
                    className="cart-item-remove"
                    title="Remove from favorites"
                    aria-label={`Remove ${f.name ?? f.sku} from favorites`}
                    onClick={() => onRemoveFavorite(f.provider, f.sku)}
                  >
                    ♥
                  </button>
                </div>
                <div className="cart-item-meta">
                  <span>
                    {f.price != null ? `$${f.price.toFixed(2)}` : ''}
                    {f.provider !== provider ? ` · ${f.provider}` : ''}
                  </span>
                  {addable ? (
                    <button className="add-btn" onClick={() => onAdd(f.sku, f.provider)}>
                      + add
                    </button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {zoom ? (
        <Lightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />
      ) : null}
    </>
  )
}
