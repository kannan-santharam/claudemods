// One still frame of the whole office, fitted into another canvas at its own
// size: the List view's preview. Everything the main canvas keeps between
// frames (its size, the floor cache, the hit boxes for hover) is put back.

import { draw, settleAll } from './frame.js'
import { worldBounds } from './layout.js'

function fitMini(scene, target) {
  const { minX, maxX, minY, maxY } = worldBounds(scene)
  const spanX = maxX - minX, spanY = maxY - minY
  // As tall as the room is for its width, so the preview has no empty bands.
  const cssWidth = Math.floor(target.clientWidth)
  const cssHeight = Math.max(110, Math.min(240, Math.round(cssWidth * spanY / spanX)))
  if (!cssWidth) return false
  if (target.style.height !== cssHeight + 'px') target.style.height = cssHeight + 'px'
  const scale = Math.min(cssWidth / spanX, cssHeight / spanY)
  const ratio = window.devicePixelRatio || 1
  const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2
  scene.view = { scale, baseScale: scale, ratio, cssWidth, cssHeight, spanX, spanY, baseCenterX: centerX, baseCenterY: centerY, offsetX: cssWidth / 2 - centerX * scale, offsetY: cssHeight / 2 - centerY * scale }
  if (target.width !== Math.round(cssWidth * ratio) || target.height !== Math.round(cssHeight * ratio)) {
    target.width = Math.round(cssWidth * ratio)
    target.height = Math.round(cssHeight * ratio)
  }
  return true
}
export function drawMini(scene, target) {
  if (scene.isActive || !target || !target.clientWidth) return
  // Nobody walks while the Office tab is closed: everyone is simply where they belong.
  settleAll(scene)
  const saved = { canvas: scene.canvas, mainPen: scene.mainPen, pen: scene.pen, view: scene.view, floorCache: scene.floorCache, floorCacheKey: scene.floorCacheKey, hitBoxes: scene.hitBoxes, lights: scene.lights, hoveredKey: scene.hoveredKey, showNames: scene.showNames }
  scene.canvas = target
  scene.mainPen = target.getContext('2d')
  scene.floorCache = scene.miniFloor
  scene.floorCacheKey = scene.miniFloorKey
  scene.hoveredKey = ''
  scene.showNames = false
  try {
    draw(scene, () => fitMini(scene, target))
  } finally {
    scene.miniFloor = scene.floorCache
    scene.miniFloorKey = scene.floorCacheKey
    Object.assign(scene, saved)
  }
}
