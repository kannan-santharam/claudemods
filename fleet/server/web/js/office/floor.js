// The floor, cached: planks, sunlight from the windows, the rugs, the nap
// room's carpet, the walls, the door and the zone names, redrawn only when
// something they show changes.

import { alpha, mix } from './colors.js'
import { LOUNGE_WIDTH, WALL_HEIGHT } from './constants.js'
import { hashOf, toScreen } from './helpers.js'
import { worldTransform } from './layout.js'
import { disc, floorQuad, polygon, prism } from './primitives.js'

// The floor, the walls and the rugs, drawn once into a cache until the room,
// the theme, the view or the hour changes.
export function renderFloor(scene) {
  const colors = scene.colors
  const hourBucket = Math.floor(Date.now() / 600_000)
  const key = [scene.layout.key, scene.view.cssWidth, scene.view.cssHeight, scene.view.ratio, scene.view.scale.toFixed(4), scene.view.offsetX.toFixed(1), scene.view.offsetY.toFixed(1), colors.isDark, colors.floorA, hourBucket].join('|')
  if (scene.floorCache && key === scene.floorCacheKey) return
  scene.floorCacheKey = key
  scene.floorCache = scene.floorCache || document.createElement('canvas')
  scene.floorCache.width = scene.canvas.width
  scene.floorCache.height = scene.canvas.height
  const target = scene.floorCache.getContext('2d')
  target.setTransform(1, 0, 0, 1, 0, 0)
  target.clearRect(0, 0, scene.floorCache.width, scene.floorCache.height)
  worldTransform(scene, target)
  scene.pen = target
  const { floorWidth, floorDepth, corridorY, utilityX } = scene.layout
  prism(scene, 0, 0, floorWidth, floorDepth, 8, -8, colors.floorEdge)
  // Wooden planks running along the room, staggered.
  for (let gy = 0; gy < floorDepth; gy += 0.5) {
    const rowIndex = Math.round(gy * 2)
    const offset = (hashOf('row' + rowIndex) % 7) * 0.31
    floorQuad(scene, 0, gy, floorWidth, gy + 0.5, rowIndex % 2 ? colors.plankA : colors.plankB)
    scene.pen.strokeStyle = alpha(colors.plankLine, 0.35)
    scene.pen.lineWidth = 0.5
    for (let gx = offset; gx < floorWidth; gx += 2.2) {
      const from = toScreen(gx, gy), to = toScreen(gx, gy + 0.5)
      scene.pen.beginPath(); scene.pen.moveTo(from.x, from.y); scene.pen.lineTo(to.x, to.y); scene.pen.stroke()
    }
  }
  // Sunlight from the windows on the floor, moving with the hour.
  const daylight = 1 - scene.nightness
  if (daylight > 0.05) {
    const hour = new Date().getHours() + new Date().getMinutes() / 60
    const lean = Math.max(-1, Math.min(1, (hour - 13) / 5))
    scene.pen.globalAlpha = 0.5 * daylight
    for (const [from, to] of scene.layout.backWindows) {
      polygon(scene, [toScreen(from + lean * 0.3, 0.15), toScreen(to + lean * 0.3, 0.15), toScreen(to + lean * 1.5, 2.1), toScreen(from + lean * 1.5, 2.1)], colors.isDark ? 'rgba(255,240,200,.08)' : 'rgba(255,246,214,.55)')
    }
    for (const [from, to] of scene.layout.leftWindows) {
      polygon(scene, [toScreen(0.15, from - lean * 0.3), toScreen(0.15, to - lean * 0.3), toScreen(2.0, to + 0.6), toScreen(2.0, from + 0.6)], colors.isDark ? 'rgba(255,240,200,.08)' : 'rgba(255,246,214,.5)')
    }
    scene.pen.globalAlpha = 1
  }
  // The lounge rug with a border under both halves of the lounge, the nap
  // room's dim carpet over its back corner, and the tiled floor of the
  // utility corner.
  const rug = mix(colors.floorA, colors.accent, colors.isDark ? 0.18 : 0.14)
  const rugRight = LOUNGE_WIDTH - 0.3
  floorQuad(scene, 0.6, 2.75, rugRight, corridorY - 0.5, mix(rug, colors.text, 0.12))
  floorQuad(scene, 0.72, 2.87, rugRight - 0.12, corridorY - 0.62, rug)
  floorQuad(scene, 0.95, 3.1, rugRight - 0.35, corridorY - 0.85, null, alpha(colors.label, 0.55))
  const napRoom = scene.layout.napRoom
  floorQuad(scene, napRoom.x0, 0, napRoom.x1, napRoom.depth, colors.napFloor)
  floorQuad(scene, napRoom.x0 + 0.15, 0.15, napRoom.x1 - 0.15, napRoom.depth - 0.15, null, alpha(colors.text, 0.12))
  for (let gx = Math.floor(utilityX); gx < floorWidth; gx++) {
    for (let gy = 0; gy < Math.ceil(scene.layout.rackDepth + 1.4); gy++) floorQuad(scene, Math.max(gx, utilityX - 0.2), gy, gx + 1, gy + 1, (gx + gy) % 2 ? mix(colors.floorA, colors.metal[2], 0.24) : mix(colors.floorB, colors.metal[2], 0.3))
  }
  // One rug per project, in its colour.
  for (const segment of scene.layout.segments) {
    const tint = mix(colors.floorA, segment.color, colors.isDark ? 0.26 : 0.2)
    floorQuad(scene, segment.x0 - 0.95, segment.gy - 0.7, segment.x1 + 0.95, segment.gy + 1.5, mix(tint, segment.color, 0.25))
    floorQuad(scene, segment.x0 - 0.85, segment.gy - 0.6, segment.x1 + 0.85, segment.gy + 1.4, tint)
  }
  // Walls: the left one along gy, the back one along gx, with a skirting board.
  polygon(scene, [toScreen(0, 0), toScreen(0, floorDepth), toScreen(0, floorDepth, WALL_HEIGHT), toScreen(0, 0, WALL_HEIGHT)], colors.wallLeft, colors.border)
  polygon(scene, [toScreen(0, 0), toScreen(floorWidth, 0), toScreen(floorWidth, 0, WALL_HEIGHT), toScreen(0, 0, WALL_HEIGHT)], colors.wallBack, colors.border)
  polygon(scene, [toScreen(0, 0), toScreen(floorWidth, 0), toScreen(floorWidth, 0, 4), toScreen(0, 0, 4)], mix(colors.wallBack, colors.text, 0.12))
  polygon(scene, [toScreen(0, 0), toScreen(0, floorDepth), toScreen(0, floorDepth, 4), toScreen(0, 0, 4)], mix(colors.wallLeft, colors.text, 0.1))
  // The nap room's stretch of the back wall, painted its own dusky colour.
  polygon(scene, [toScreen(napRoom.x0, 0, 4), toScreen(napRoom.x1, 0, 4), toScreen(napRoom.x1, 0, WALL_HEIGHT), toScreen(napRoom.x0, 0, WALL_HEIGHT)], mix(colors.napWall, colors.wallBack, 0.35))
  polygon(scene, [toScreen(0, 0, WALL_HEIGHT), toScreen(floorWidth, 0, WALL_HEIGHT), toScreen(floorWidth, -0.25, WALL_HEIGHT), toScreen(-0.25, -0.25, WALL_HEIGHT), toScreen(-0.25, floorDepth, WALL_HEIGHT), toScreen(0, floorDepth, WALL_HEIGHT)], colors.wallTop)
  // The door, in the left wall at the corridor.
  polygon(scene, [toScreen(0, corridorY - 0.55), toScreen(0, corridorY + 0.55), toScreen(0, corridorY + 0.55, 58), toScreen(0, corridorY - 0.55, 58)], colors.wood[1], colors.border)
  polygon(scene, [toScreen(0, corridorY - 0.42), toScreen(0, corridorY + 0.42), toScreen(0, corridorY + 0.42, 50), toScreen(0, corridorY - 0.42, 50)], null, alpha(colors.wood[2], 0.8))
  const handle = toScreen(0, corridorY + 0.35, 28)
  disc(scene, handle.x, handle.y, 1.6, 1.6, colors.metal[2])
  // A doormat.
  floorQuad(scene, 0.05, corridorY - 0.45, 0.75, corridorY + 0.45, mix(colors.floorA, colors.text, 0.22))
  // Zone names.
  target.font = '600 11px -apple-system, system-ui, sans-serif'
  target.fillStyle = colors.muted
  target.textAlign = 'center'
  const rackLabel = toScreen(utilityX + 1.5, scene.layout.rackDepth + 1.75)
  target.fillText('Server racks', rackLabel.x, rackLabel.y)
  scene.pen = scene.mainPen
}
