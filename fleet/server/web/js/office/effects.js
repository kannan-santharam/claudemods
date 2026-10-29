// Parcels for commits and paper planes for pushes, launched from a desk and
// flown through world space to the outbox or out of a window.

import { toScreen } from './helpers.js'
import { block, polygon } from './primitives.js'
import { isReduced } from './scene.js'

// Parcels for commits and paper planes for pushes, flying in world space.
export function launch(scene, kind, from) {
  if (isReduced(scene) || !scene.isActive || document.visibilityState !== 'visible') { if (kind === 'parcel') scene.outboxCount++; return }
  const start = scene.clockSeconds
  if (kind === 'parcel') {
    const to = { gx: scene.layout.printer.gx + 0.4, gy: scene.layout.printer.gy + 0.3, height: 32 }
    scene.effects.push({ kind, from: { ...from, height: 34 }, to, start, duration: 1.4 + Math.hypot(to.gx - from.gx, to.gy - from.gy) * 0.06 })
  } else {
    const windows = scene.layout.backWindows.length ? scene.layout.backWindows : [[scene.layout.deskStartX, scene.layout.deskStartX + 1.6]]
    const [windowFrom, windowTo] = windows.reduce((best, item) => (Math.abs((item[0] + item[1]) / 2 - from.gx) < Math.abs((best[0] + best[1]) / 2 - from.gx) ? item : best))
    scene.effects.push({ kind, from: { ...from, height: 40 }, to: { gx: (windowFrom + windowTo) / 2, gy: 0.05, height: 54 }, start, duration: 2.2 })
  }
}
export function drawEffects(scene) {
  const pen = scene.pen
  scene.effects = scene.effects.filter(effect => {
    const progress = (scene.clockSeconds - effect.start) / effect.duration
    if (progress >= 1) { if (effect.kind === 'parcel') scene.outboxCount++; return false }
    const eased = effect.kind === 'plane' ? progress * progress * (3 - 2 * progress) : progress
    const gx = effect.from.gx + (effect.to.gx - effect.from.gx) * eased
    const gy = effect.from.gy + (effect.to.gy - effect.from.gy) * eased
    const lift = Math.sin(progress * Math.PI) * (effect.kind === 'parcel' ? 46 : 30)
    const height = effect.from.height + (effect.to.height - effect.from.height) * eased + lift
    const point = toScreen(gx, gy, height)
    pen.save()
    pen.translate(point.x, point.y)
    if (effect.kind === 'parcel') {
      pen.rotate(Math.sin(progress * Math.PI * 2) * 0.3)
      block(scene, -4.5, -4, 9, 8, 1, '#d2a46c')
      pen.fillStyle = '#a77a45'; pen.fillRect(-0.7, -4, 1.4, 8)
    } else {
      const ahead = toScreen(effect.from.gx + (effect.to.gx - effect.from.gx) * Math.min(1, eased + 0.02), effect.from.gy + (effect.to.gy - effect.from.gy) * Math.min(1, eased + 0.02), height)
      pen.rotate(Math.atan2(ahead.y - point.y, ahead.x - point.x))
      pen.globalAlpha = progress > 0.85 ? (1 - progress) / 0.15 : 1
      polygon(scene, [{ x: 7, y: 0 }, { x: -6, y: -4.5 }, { x: -3, y: 0 }], '#ffffff', 'rgba(0,0,0,.25)')
      polygon(scene, [{ x: 7, y: 0 }, { x: -6, y: 3.5 }, { x: -3, y: 0 }], '#e7e7e7', 'rgba(0,0,0,.25)')
    }
    pen.restore()
    return true
  })
}
