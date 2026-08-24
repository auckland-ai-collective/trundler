import { useMemo, useState } from 'react'
import type { Favorite } from '../../shared/types.js'
import { unitLabel, unitOptions, upsizeImage, type PricingUnit } from '../blocks.js'
import { Lightbox } from './Lightbox.js'
import { QuantityPicker } from './QuantityPicker.js'

interface Props {
  favorites: Favorite[]
  /** The active provider — favorites from it can be added to the cart directly. */
  provider: string
  canAdd: boolean
  onAdd: (sku: string, provider: string, quantity: number, unit: PricingUnit) => void
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
          {visible.map((f) => (
            <FavoriteRow
              key={`${f.provider}-${f.sku}`}
              favorite={f}
              addable={canAdd && f.provider === provider}
              activeProvider={provider}
              onAdd={onAdd}
              onRemoveFavorite={onRemoveFavorite}
              onZoom={setZoom}
            />
          ))}
        </ul>
      )}

      {zoom ? (
        <Lightbox src={zoom.src} alt={zoom.name} caption={zoom.name} onClose={() => setZoom(null)} />
      ) : null}
    </>
  )
}

interface RowProps {
  favorite: Favorite
  addable: boolean
  activeProvider: string
  onAdd: (sku: string, provider: string, quantity: number, unit: PricingUnit) => void
  onRemoveFavorite: (provider: string, sku: string) => void
  onZoom: (zoom: { src: string; name: string }) => void
}

/** One saved product. Carries its own pending quantity/unit for the same reason
 *  the result cards do — a favourited bag of loose apples is bought by the kilo,
 *  and the row has to say so before it's added. */
function FavoriteRow({
  favorite: f,
  addable,
  activeProvider,
  onAdd,
  onRemoveFavorite,
  onZoom
}: RowProps): JSX.Element {
  const units = useMemo(() => unitOptions(f), [f])
  const [unit, setUnit] = useState<PricingUnit>(units[0])
  const [qty, setQty] = useState(1)

  return (
    <li className="cart-item">
      <div className="cart-item-top">
        {f.image ? (
          <img
            className="cart-thumb"
            src={f.image}
            alt=""
            loading="lazy"
            title="Click to enlarge"
            onClick={() => onZoom({ src: upsizeImage(f.image as string), name: f.name })}
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
          {f.price != null ? `$${f.price.toFixed(2)}${units[0] === 'Kg' ? ' /kg' : ''}` : ''}
          {f.provider !== activeProvider ? ` · ${f.provider}` : ''}
        </span>
        {addable ? (
          <button
            className="add-btn"
            title={`Add ${qty} ${unitLabel(unit)} to cart`}
            onClick={() => onAdd(f.sku, f.provider, qty, unit)}
          >
            + add
          </button>
        ) : null}
      </div>
      {addable ? (
        <div className="cart-item-meta">
          <QuantityPicker
            quantity={qty}
            unit={unit}
            units={units}
            compact
            label={f.name ?? f.sku}
            onQuantityChange={setQty}
            onUnitChange={setUnit}
          />
        </div>
      ) : null}
    </li>
  )
}
