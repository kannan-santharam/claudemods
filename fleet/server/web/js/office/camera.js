// The camera: zoom and pan clamped to the room, eased toward a goal each
// frame, zooming around a point, and wall mode's close-up on whoever needs you.

import { draw, wake } from './frame.js'
import { toScreen } from './helpers.js'
import { isReduced, isWallMode } from './scene.js'

function clampCamera(scene, goal) {
  const zoom = Math.min(3, Math.max(1, goal.zoom))
  const limitX = (scene.view.spanX / 2) * (1 - 1 / zoom), limitY = (scene.view.spanY / 2) * (1 - 1 / zoom)
  return { zoom, x: Math.max(-limitX, Math.min(limitX, goal.x)), y: Math.max(-limitY, Math.min(limitY, goal.y)) }
}
export function setCamera(scene, goal, immediate) {
  scene.cameraGoal = clampCamera(scene, goal)
  if (immediate || isReduced(scene)) scene.camera = { ...scene.cameraGoal }
  if (isReduced(scene)) draw(scene); else wake(scene)
}
export function focusOn(scene, person) {
  // In wall mode the camera moves in on whoever needs you, then eases back.
  if (!isWallMode(scene) || isReduced(scene) || !person) return
  const point = toScreen(person.gx, person.gy, 26)
  scene.cameraGoal = clampCamera(scene, { zoom: 1.8, x: point.x - scene.view.baseCenterX, y: point.y - scene.view.baseCenterY })
  scene.cameraReturnAt = Date.now() + 6000
  wake(scene)
}
export function zoomAround(scene, zoom, screenX, screenY) {
  scene.cameraReturnAt = 0
  const worldX = (screenX - scene.view.offsetX) / scene.view.scale, worldY = (screenY - scene.view.offsetY) / scene.view.scale
  const nextZoom = Math.min(3, Math.max(1, zoom))
  const nextScale = scene.view.baseScale * nextZoom
  setCamera(scene, { zoom: nextZoom, x: (scene.view.cssWidth / 2 - screenX) / nextScale + worldX - scene.view.baseCenterX, y: (scene.view.cssHeight / 2 - screenY) / nextScale + worldY - scene.view.baseCenterY }, true)
}
