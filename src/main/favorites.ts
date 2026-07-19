import { app } from 'electron'
import { join } from 'node:path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import type { Favorite, Product } from '../shared/types.js'

/** Favorites persist to their own JSON file in userData, mirroring config.ts.
 *  Each entry is a full product snapshot so the favorites view renders without
 *  any MCP lookup (the package has no get-by-SKU tool), and cart_add / the agent
 *  can act on the stored SKU directly. */
function favoritesPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'favorites.json')
}

const keyOf = (provider: string, sku: string): string => `${provider}:${sku}`

export function loadFavorites(): Favorite[] {
  try {
    const path = favoritesPath()
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      if (Array.isArray(data)) return data as Favorite[]
    }
  } catch (err) {
    console.error('[favorites] failed to load:', err)
  }
  return []
}

function saveFavorites(list: Favorite[]): void {
  try {
    writeFileSync(favoritesPath(), JSON.stringify(list, null, 2), 'utf-8')
  } catch (err) {
    console.error('[favorites] failed to save:', err)
  }
}

/** Add the product if not already favorited (for this provider), else remove it.
 *  Returns the new list, persisted. */
export function toggleFavorite(list: Favorite[], provider: string, product: Product): Favorite[] {
  const key = keyOf(provider, product.sku)
  const exists = list.some((f) => keyOf(f.provider, f.sku) === key)
  const next = exists
    ? list.filter((f) => keyOf(f.provider, f.sku) !== key)
    : [...list, { ...product, provider, addedAt: new Date().toISOString() }]
  saveFavorites(next)
  return next
}

export function removeFavorite(list: Favorite[], provider: string, sku: string): Favorite[] {
  const next = list.filter((f) => keyOf(f.provider, f.sku) !== keyOf(provider, sku))
  saveFavorites(next)
  return next
}
