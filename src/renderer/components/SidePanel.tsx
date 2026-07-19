import { useState } from 'react'
import type { Cart, Favorite, Product } from '../../shared/types.js'
import { CartPanel } from './CartPanel.js'
import { FavoritesPanel } from './FavoritesPanel.js'

interface Props {
  cart: Cart | null
  provider: string
  note: string | null
  images: Record<string, string>
  loading: boolean
  busy: boolean
  updatedAt: string | null
  onRefresh: () => void
  onRemove: (sku: string, unit: string | undefined, provider: string) => void
  onChangeQty: (sku: string, quantity: number, unit: string | undefined, provider: string) => void
  favorites: Favorite[]
  favoriteKeys: Set<string>
  canAdd: boolean
  onAdd: (sku: string, provider: string) => void
  onToggleFavorite: (product: Product, provider: string) => void
  onRemoveFavorite: (provider: string, sku: string) => void
}

type Tab = 'cart' | 'favorites'

/** The right-hand panel: a Cart tab and a Favorites tab sharing one column. */
export function SidePanel(props: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>('cart')
  const favCount = props.favorites.length

  return (
    <aside className="cart-panel">
      <div className="side-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'cart'}
          className={`side-tab${tab === 'cart' ? ' on' : ''}`}
          onClick={() => setTab('cart')}
        >
          Cart
        </button>
        <button
          role="tab"
          aria-selected={tab === 'favorites'}
          className={`side-tab${tab === 'favorites' ? ' on' : ''}`}
          onClick={() => setTab('favorites')}
        >
          ♥ Favorites{favCount ? ` (${favCount})` : ''}
        </button>
      </div>

      {tab === 'cart' ? (
        <CartPanel
          cart={props.cart}
          provider={props.provider}
          note={props.note}
          images={props.images}
          loading={props.loading}
          busy={props.busy}
          updatedAt={props.updatedAt}
          onRefresh={props.onRefresh}
          onRemove={props.onRemove}
          onChangeQty={props.onChangeQty}
          favoriteKeys={props.favoriteKeys}
          onToggleFavorite={props.onToggleFavorite}
        />
      ) : (
        <FavoritesPanel
          favorites={props.favorites}
          provider={props.provider}
          canAdd={props.canAdd}
          onAdd={props.onAdd}
          onRemoveFavorite={props.onRemoveFavorite}
        />
      )}
    </aside>
  )
}
