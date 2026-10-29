// Where everything stands: the room plan built from the projects and the
// racks in use, the world bounds, fitting the view into the canvas, and the
// transform from the floor grid to device pixels.

import { DESK_STEP_X, DESK_STEP_Y, GROUP_GAP, LOUNGE_WIDTH, TILE_X, TILE_Y, UTILITY_WIDTH, WALL_HEIGHT } from './constants.js'
import { isWallMode } from './scene.js'

// The lounge is on the left, then the projects: each folder gets a run of
// desks on its own rug, packed into rows, in the order the folders first
// appeared, so a project keeps its place as others come and go. The
// utility corner on the right holds the bookshelf, the globe, the server
// racks, the printer with its outbox and the shredder. A corridor runs along
// the front, with the door in the left wall.
export function buildLayout(groups, rackCount) {
  const total = groups.reduce((sum, group) => sum + group.members.length, 0)
  // Rows about as long as the room is deep, so the office stays roughly square.
  const perRow = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(total * 1.3))))
  const deskStartX = LOUNGE_WIDTH + 1.4
  const deskBySession = new Map()
  const segments = []
  let row = 0, column = 0, gaps = 0, widest = 0
  for (const group of groups) {
    const size = group.members.length
    if (column > 0 && column + Math.min(size, perRow) > perRow) { row++; column = 0; gaps = 0 }
    if (column > 0) gaps++
    let segment = null
    group.members.forEach((sessionId, index) => {
      if (column === perRow) { row++; column = 0; gaps = 0; segment = null }
      const gx = deskStartX + column * DESK_STEP_X + gaps * GROUP_GAP
      const gy = 1.6 + row * DESK_STEP_Y
      deskBySession.set(sessionId, { gx, gy, group: group.key })
      if (!segment) { segment = { key: group.key, label: group.label, color: group.color, x0: gx, x1: gx, gy, isFirst: index === 0, count: size }; segments.push(segment) }
      segment.x1 = gx
      widest = Math.max(widest, gx - deskStartX + 1)
      column++
    })
  }
  const rows = segments.length ? row + 1 : 0
  const utilityX = deskStartX + Math.max(widest, 1.2) + 0.9
  const rackRows = Math.max(1, Math.ceil(Math.max(rackCount, 2) / 2))
  const racks = []
  for (let slot = 0; slot < rackRows * 2; slot++) racks.push({ gx: utilityX + 0.6 + (slot % 2) * 1.5, gy: 2.15 + Math.floor(slot / 2) * 2.4 })
  const rackBottom = 2.15 + (rackRows - 1) * 2.4 + 1.4
  const floorDepth = Math.ceil(Math.max(8.4, 1.6 + rows * DESK_STEP_Y + 0.6, rackBottom + 3.2))
  const floorWidth = Math.ceil(utilityX + UTILITY_WIDTH)
  const corridorY = floorDepth - 0.65
  const lounge = []
  for (const gx of [1.75, 2.55, 3.35]) lounge.push({ gx, gy: 2.05, pose: 'sofa', facing: 'front' })
  lounge.push({ gx: 1.1, gy: 3.9, pose: 'pong', facing: 'front', side: 0 }, { gx: 3.95, gy: 3.9, pose: 'pong', facing: 'front', side: 1 })
  // Standing spots fill every other row first, staggered, so a crowd spreads over the rug.
  const standing = []
  for (let line = 0, gy = 5.1; gy <= corridorY - 0.9; line++, gy += 1.05) {
    for (const gx of line % 2 ? [1.9, 3.3] : [1.2, 2.6, 4.0]) standing.push({ gx, gy, pose: 'stand', facing: 'front', line })
  }
  standing.sort((first, second) => (first.line % 2) - (second.line % 2) || first.line - second.line)
  lounge.push(...standing)
  const backWindows = []
  for (let gx = deskStartX - 0.4; gx + 1.6 < utilityX - 0.3; gx += 2.4) backWindows.push([gx, gx + 1.6])
  const leftWindows = []
  for (let gy = 5.0; gy + 1.8 < corridorY - 0.9; gy += 2.6) leftWindows.push([gy, gy + 1.8])
  const printer = { gx: utilityX + 0.25, gy: rackBottom + 0.1 }
  const shredder = { gx: utilityX + 1.6, gy: rackBottom + 0.25 }
  return {
    rows, perRow, deskBySession, segments, racks, lounge, floorWidth, floorDepth, corridorY, deskStartX, utilityX,
    rackDepth: rackBottom, backWindows, leftWindows, printer, shredder,
    bookshelf: { gx: utilityX + 0.1, gy: 0.06 },
    globe: { gx: utilityX + 2.3, gy: 0.75 },
    globeSpots: [{ gx: utilityX + 1.95, gy: 1.4 }, { gx: utilityX + 2.65, gy: 1.45 }, { gx: utilityX + 2.3, gy: 1.75 }],
    watchSpots: racks.filter((rack, slot) => slot % 2 === 0).flatMap(rack => [{ gx: utilityX + 1.1, gy: rack.gy + 1.05 }, { gx: utilityX + 1.7, gy: rack.gy + 1.1 }]),
    shelfSpots: [{ gx: utilityX + 0.55, gy: 0.95 }, { gx: utilityX + 1.2, gy: 0.95 }],
    coffeeSpots: [{ gx: 0.62, gy: 1.2 }, { gx: 0.62, gy: 1.75 }],
    shredSpots: [{ gx: shredder.gx + 0.3, gy: shredder.gy + 0.95 }, { gx: shredder.gx - 0.35, gy: shredder.gy + 1.05 }],
    door: { gx: 0.4, gy: corridorY },
    outside: { gx: -0.9, gy: corridorY },
    key: [floorWidth, floorDepth, rackRows, ...segments.map(segment => `${segment.key}:${segment.x0}:${segment.x1}:${segment.gy}`)].join('|'),
  }
}
export function worldBounds(scene) {
  const { floorWidth, floorDepth } = scene.layout
  return { minX: -floorDepth * TILE_X - 24, maxX: floorWidth * TILE_X + 24, minY: -WALL_HEIGHT - 30, maxY: (floorWidth + floorDepth) * TILE_Y + 26 }
}
export function fitView(scene) {
  const holder = scene.canvas.parentElement
  const cssWidth = Math.floor(holder.clientWidth)
  if (!cssWidth) return false
  const { minX, maxX, minY, maxY } = worldBounds(scene)
  const spanX = maxX - minX, spanY = maxY - minY
  let baseScale, cssHeight
  if (isWallMode(scene)) {
    cssHeight = Math.max(200, Math.floor(holder.clientHeight))
    baseScale = Math.min(cssWidth / spanX, cssHeight / spanY)
  } else {
    baseScale = Math.max(0.35, Math.min(1.5, cssWidth / spanX, 640 / spanY))
    cssHeight = Math.round(spanY * baseScale)
  }
  const scale = baseScale * scene.camera.zoom
  const baseCenterX = (minX + maxX) / 2, baseCenterY = (minY + maxY) / 2
  const centerX = baseCenterX + scene.camera.x, centerY = baseCenterY + scene.camera.y
  const ratio = window.devicePixelRatio || 1
  scene.view = { scale, baseScale, ratio, cssWidth, cssHeight, spanX, spanY, baseCenterX, baseCenterY, offsetX: cssWidth / 2 - centerX * scale, offsetY: cssHeight / 2 - centerY * scale }
  if (scene.canvas.width !== Math.round(cssWidth * ratio) || scene.canvas.height !== Math.round(cssHeight * ratio)) {
    scene.canvas.width = Math.round(cssWidth * ratio)
    scene.canvas.height = Math.round(cssHeight * ratio)
    scene.canvas.style.height = cssHeight + 'px'
  }
  return true
}
export const worldTransform = (scene, target, factor = 1) => target.setTransform(scene.view.ratio * scene.view.scale * factor, 0, 0, scene.view.ratio * scene.view.scale * factor, scene.view.ratio * scene.view.offsetX * factor, scene.view.ratio * scene.view.offsetY * factor)
