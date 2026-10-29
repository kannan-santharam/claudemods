// Small pure helpers the office shares: a stable hash for seeding looks and
// layouts, the floor-grid to screen projection, the first free slot in a map,
// truncation, and what a session wears and which project it belongs to.
// Floor-grid coordinates are gx (along the back wall) and gy (along the left
// wall); x and y are screen pixels.

import { TILE_X, TILE_Y } from './constants.js'

export const hashOf = text => { let hash = 2166136261; for (const character of String(text)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619); return hash >>> 0 }
export const toScreen = (gx, gy, height = 0) => ({ x: (gx - gy) * TILE_X, y: (gx + gy) * TILE_Y - height })
export const firstFree = (used, from = 0) => { const taken = new Set(used.values()); let index = from; while (taken.has(index)) index++; return index }
export const truncate = (text, length) => (text.length > length ? text.slice(0, length - 1) + '…' : text)
export const outfitOf = model => {
  const name = String(model || '').toLowerCase()
  return name.includes('opus') ? 'blazer' : name.includes('sonnet') ? 'hoodie' : name.includes('haiku') ? 'beanie' : name.includes('fable') ? 'headphones' : ''
}
export const folderOf = session => session.folder || session.cwd || 'other'
