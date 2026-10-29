// Where everything stands: the room plan built from the projects and the
// racks in use, the lounge's spots for the idle (sofa, ping-pong, snooker,
// standing and the nap room), the world bounds, fitting the view into the
// canvas, and the transform from the floor grid to device pixels.

import { DESK_STEP_X, DESK_STEP_Y, GROUP_GAP, LOUNGE_SPLIT_X, LOUNGE_WIDTH, TILE_X, TILE_Y, UTILITY_WIDTH, WALL_HEIGHT } from './constants.js'
import { isWallMode } from './scene.js'

// The nap room sits in the back corner of the lounge's right half, against
// the back wall, so its own back wall is the room's and nothing hides it; its
// door faces the snooker table. The snooker table stands in front of it.
// Both are fixed, like the sofa and the ping-pong table on the left.
const NAP_ROOM = { x0: LOUNGE_SPLIT_X + 0.2, x1: LOUNGE_WIDTH - 0.6, depth: 3.2, doorFrom: 5.95, doorTo: 6.65 }
const SNOOKER_TABLE = { gx: 5.3, gy: 4.55, width: 2.0, depth: 1.0 }
function napRoomPlan() {
  const { x0, x1, depth, doorFrom, doorTo } = NAP_ROOM
  const doorX = (doorFrom + doorTo) / 2
  // Sleepers go in and out by the door: from just outside it, to just inside.
  const via = [{ gx: doorX, gy: depth + 0.45 }, { gx: doorX, gy: depth - 0.45 }]
  const beds = [{ gx: x0 + 0.2, gy: 0.15 }, { gx: x0 + 1.45, gy: 0.15 }].map(bed => ({ ...bed, width: 0.75, depth: 1.45 }))
  // The bean bags stand back from the low front wall so it never hides them.
  const beanbags = [{ gx: x0 + 0.5, gy: depth - 1.05 }, { gx: x1 - 0.45, gy: depth - 1.0 }]
  const spots = [
    ...beds.map(bed => ({ gx: bed.gx + bed.width / 2, gy: bed.gy + 0.8, pose: 'bed', facing: 'front', corner: 'nap', zone: 'nap', via })),
    ...beanbags.map(beanbag => ({ ...beanbag, pose: 'beanbag', facing: 'front', corner: 'nap', zone: 'nap', via })),
  ]
  return { x0, x1, depth, doorFrom, doorTo, beds, beanbags, nightLight: { gx: (beds[0].gx + beds[0].width + beds[1].gx) / 2, gy: 0.3 }, spots }
}
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
  // Every lounge spot names its corner, which is what an idle session's id picks (see sync.js).
  const napRoom = napRoomPlan()
  const snooker = SNOOKER_TABLE
  const lounge = []
  for (const gx of [1.75, 2.55, 3.35]) lounge.push({ gx, gy: 2.05, pose: 'sofa', facing: 'front', corner: 'sofa' })
  lounge.push({ gx: 1.1, gy: 3.9, pose: 'pong', facing: 'front', side: 0, corner: 'pong' }, { gx: 3.95, gy: 3.9, pose: 'pong', facing: 'front', side: 1, corner: 'pong' })
  // One snooker player in front of the table looking in, the other behind it looking out.
  lounge.push(
    { gx: snooker.gx + 0.65, gy: snooker.gy + snooker.depth + 0.45, pose: 'snooker', facing: 'back', side: 0, corner: 'snooker' },
    { gx: snooker.gx + 1.4, gy: snooker.gy - 0.43, pose: 'snooker', facing: 'front', side: 1, corner: 'snooker' },
  )
  lounge.push(...napRoom.spots)
  // Standing spots fill every other row first, staggered, so a crowd spreads
  // over the rug: on the left from below the ping-pong table, on the right
  // from below the snooker table.
  const standing = []
  for (let line = 0, gy = 5.1; gy <= corridorY - 0.9; line++, gy += 1.05) {
    for (const gx of line % 2 ? [1.9, 3.3] : [1.2, 2.6, 4.0]) standing.push({ gx, gy, pose: 'stand', facing: 'front', corner: 'stand', line })
  }
  for (let line = 0, gy = snooker.gy + snooker.depth + 1.35; gy <= corridorY - 0.9; line++, gy += 1.05) {
    for (const gx of line % 2 ? [6.4] : [5.5, 7.1]) standing.push({ gx, gy, pose: 'stand', facing: 'front', corner: 'stand', line })
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
    rows, perRow, deskBySession, segments, racks, lounge, napRoom, snooker, floorWidth, floorDepth, corridorY, deskStartX, utilityX,
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
