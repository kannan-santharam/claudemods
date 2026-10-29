// Day and night: how dark it is outside by the local time, the room darkened
// at night except where lamps and screens shine, and the red vignette when
// someone has waited too long.

import { alpha } from './colors.js'
import { WALL_HEIGHT } from './constants.js'
import { toScreen } from './helpers.js'
import { worldTransform } from './layout.js'
import { glow } from './primitives.js'
import { isReduced } from './scene.js'

// How dark it is outside: 0 by day, 1 at night. The dark theme is always night.
export function nightnessNow(scene) {
  if (scene.colors.isDark) return 1
  const date = new Date()
  const hour = date.getHours() + date.getMinutes() / 60
  if (hour >= 7 && hour <= 17) return 0
  if (hour > 17 && hour < 19.5) return (hour - 17) / 2.5
  if (hour >= 5.5 && hour < 7) return 1 - (hour - 5.5) / 1.5
  return 1
}
// At night the room darkens except where lamps and screens shine.
function roomOutline(scene) {
  const { floorWidth, floorDepth } = scene.layout
  return [toScreen(0, floorDepth, -8), toScreen(0, floorDepth, WALL_HEIGHT), toScreen(0, 0, WALL_HEIGHT), toScreen(floorWidth, 0, WALL_HEIGHT), toScreen(floorWidth, 0, -8), toScreen(floorWidth, floorDepth, -8)]
}
export function applyLighting(scene) {
  const pen = scene.pen
  const darkness = Math.min(0.72, scene.nightness * (scene.colors.isDark ? 0.4 : 0.34) + scene.dimming)
  if (darkness < 0.02) return
  const width = Math.max(1, Math.round(scene.canvas.width / 2)), height = Math.max(1, Math.round(scene.canvas.height / 2))
  if (scene.lightCanvas.width !== width || scene.lightCanvas.height !== height) { scene.lightCanvas.width = width; scene.lightCanvas.height = height }
  scene.lightPen.setTransform(1, 0, 0, 1, 0, 0)
  scene.lightPen.globalCompositeOperation = 'source-over'
  scene.lightPen.clearRect(0, 0, width, height)
  worldTransform(scene, scene.lightPen, 0.5)
  scene.lightPen.beginPath()
  roomOutline(scene).forEach((point, index) => (index ? scene.lightPen.lineTo(point.x, point.y) : scene.lightPen.moveTo(point.x, point.y)))
  scene.lightPen.closePath()
  scene.lightPen.fillStyle = `rgba(6,10,28,${darkness})`
  scene.lightPen.fill()
  scene.lightPen.globalCompositeOperation = 'destination-out'
  const lightStrength = Math.min(1, scene.nightness + 0.2) * (1 - Math.min(0.5, scene.dimming))
  for (const light of scene.lights) {
    const gradient = scene.lightPen.createRadialGradient(light.x, light.y, 1, light.x, light.y, light.radius)
    gradient.addColorStop(0, `rgba(0,0,0,${light.strength * lightStrength})`)
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    scene.lightPen.fillStyle = gradient
    scene.lightPen.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2)
  }
  pen.save()
  pen.setTransform(1, 0, 0, 1, 0, 0)
  pen.drawImage(scene.lightCanvas, 0, 0, scene.canvas.width, scene.canvas.height)
  pen.restore()
  if (scene.nightness > 0.3) {
    // Warm light pooling under lamps.
    pen.save()
    pen.globalCompositeOperation = 'lighter'
    for (const light of scene.lights) if (light.warm) glow(scene, light.x, light.y, light.radius * 0.8, '#ff9d4d', 0.07 * scene.nightness)
    pen.restore()
  }
}
export function drawVignette(scene) {
  // Someone has waited a while: the edges of the office pulse red.
  const pen = scene.pen
  const colors = scene.colors
  const urgent = [...scene.people.values()].some(person => person.isUrgent && !person.leaving)
  if (!urgent) return
  const strength = isReduced(scene) ? 0.16 : 0.12 + 0.1 * (Math.sin(scene.clockSeconds * 3) + 1) / 2
  const outline = roomOutline(scene)
  const outlineXs = outline.map(point => point.x), outlineYs = outline.map(point => point.y)
  const centerX = (Math.min(...outlineXs) + Math.max(...outlineXs)) / 2, centerY = (Math.min(...outlineYs) + Math.max(...outlineYs)) / 2
  const reach = Math.max(Math.max(...outlineXs) - Math.min(...outlineXs), Math.max(...outlineYs) - Math.min(...outlineYs)) / 2
  pen.save()
  pen.beginPath()
  outline.forEach((point, index) => (index ? pen.lineTo(point.x, point.y) : pen.moveTo(point.x, point.y)))
  pen.closePath()
  pen.clip()
  const gradient = pen.createRadialGradient(centerX, centerY, reach * 0.45, centerX, centerY, reach * 1.05)
  gradient.addColorStop(0, alpha(colors.critical, 0))
  gradient.addColorStop(1, alpha(colors.critical, strength * (colors.isDark ? 1.6 : 1.1)))
  pen.fillStyle = gradient
  pen.fillRect(centerX - reach * 1.1, centerY - reach * 1.1, reach * 2.2, reach * 2.2)
  pen.restore()
}
