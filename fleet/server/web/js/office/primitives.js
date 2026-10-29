// Drawing primitives everything else is built from: polygons, floor quads,
// boxes on the grid (prisms), rounded blocks, discs and glows, and painting
// flat onto a box face or onto the back or left wall.

import { alpha } from './colors.js'
import { SLANT, TILE_X, TILE_Y } from './constants.js'
import { toScreen } from './helpers.js'

export function polygon(scene, points, fill, stroke) {
  const pen = scene.pen
  pen.beginPath()
  points.forEach((point, index) => (index ? pen.lineTo(point.x, point.y) : pen.moveTo(point.x, point.y)))
  pen.closePath()
  if (fill) { pen.fillStyle = fill; pen.fill() }
  if (stroke) { pen.strokeStyle = stroke; pen.lineWidth = 0.6; pen.stroke() }
}
export const floorQuad = (scene, x0, y0, x1, y1, fill, stroke) => polygon(scene, [toScreen(x0, y0), toScreen(x1, y0), toScreen(x1, y1), toScreen(x0, y1)], fill, stroke)
// A box on the floor grid: faces are [top, the side facing +gy, the side facing +gx].
export function prism(scene, gx, gy, width, depth, height, elevation, faces) {
  const top = elevation + height
  const backTop = toScreen(gx, gy, top), rightTop = toScreen(gx + width, gy, top)
  const frontTop = toScreen(gx + width, gy + depth, top), leftTop = toScreen(gx, gy + depth, top)
  const front = toScreen(gx + width, gy + depth, elevation), left = toScreen(gx, gy + depth, elevation), right = toScreen(gx + width, gy, elevation)
  polygon(scene, [leftTop, frontTop, front, left], faces[1])
  polygon(scene, [rightTop, frontTop, front, right], faces[2])
  polygon(scene, [backTop, rightTop, frontTop, leftTop], faces[0])
}
export function block(scene, x, y, width, height, radius, fill) {
  const pen = scene.pen
  pen.beginPath()
  pen.roundRect(x, y, width, height, radius)
  pen.fillStyle = fill
  pen.fill()
}
export function disc(scene, x, y, radiusX, radiusY, fill) {
  const pen = scene.pen
  pen.beginPath()
  pen.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2)
  pen.fillStyle = fill
  pen.fill()
}
// Draws on the face of a box that looks toward +gy: u runs 0..1 along it, v 0..1 up it.
export function onFrontFace(scene, gx, gy, width, elevation, height, paint) {
  const pen = scene.pen
  const origin = toScreen(gx, gy, elevation)
  pen.save()
  pen.transform(width * TILE_X, width * TILE_Y, 0, -height, origin.x, origin.y)
  paint()
  pen.restore()
}
// Draws flat on the back wall: x in pixels along the wall from gx, y in pixels down from height top.
export function onBackWall(scene, gx, top, paint, gy = 0.02) {
  const pen = scene.pen
  const origin = toScreen(gx, gy, top)
  pen.save()
  pen.transform(TILE_X / SLANT, TILE_Y / SLANT, 0, 1, origin.x, origin.y)
  paint()
  pen.restore()
}
// Draws flat on the left wall, read from the room: x runs from gy toward the back wall.
export function onLeftWall(scene, gy, top, paint, gx = 0.02) {
  const pen = scene.pen
  const origin = toScreen(gx, gy, top)
  pen.save()
  pen.transform(TILE_X / SLANT, -TILE_Y / SLANT, 0, 1, origin.x, origin.y)
  paint()
  pen.restore()
}
export function glow(scene, x, y, radius, color, strength) {
  const pen = scene.pen
  const gradient = pen.createRadialGradient(x, y, 1, x, y, radius)
  gradient.addColorStop(0, alpha(color, strength))
  gradient.addColorStop(1, alpha(color, 0))
  pen.fillStyle = gradient
  pen.fillRect(x - radius, y - radius, radius * 2, radius * 2)
}
