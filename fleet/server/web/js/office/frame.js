// The frame loop: drawing one frame back to front by depth, advancing time
// and walking, and waking or settling the animation as the tab, the
// visibility and the reduced-motion setting allow.

import { refreshColors } from './colors.js'
import { WALK_SPEED } from './constants.js'
import { drawChair, drawDesk, drawRack } from './desks.js'
import { drawEffects } from './effects.js'
import { drawPerson } from './figures.js'
import { renderFloor } from './floor.js'
import { drawBookshelf, drawFloorLamp, drawGlobe, drawLounge, drawPingPong, drawPlant, drawPrinter, drawShredder, drawSnooker, drawTallPlant, drawWaterCooler, napRoomDrawables } from './furniture.js'
import { fitView, worldTransform } from './layout.js'
import { applyLighting, drawVignette, nightnessNow } from './lighting.js'
import { maybeStartErrand, runErrand } from './movement.js'
import { drawOverlays } from './overlays.js'
import { isReduced } from './scene.js'
import { drawClock, drawNapSign, drawPoster, drawWhiteboard, drawWindows } from './walls.js'

export function draw(scene, fitCanvas = () => fitView(scene)) {
  if (!scene.colors) refreshColors(scene)
  if (!fitCanvas()) return
  scene.nightness = nightnessNow(scene)
  renderFloor(scene)
  scene.pen = scene.mainPen
  scene.pen.setTransform(1, 0, 0, 1, 0, 0)
  scene.pen.clearRect(0, 0, scene.canvas.width, scene.canvas.height)
  scene.pen.drawImage(scene.floorCache, 0, 0)
  worldTransform(scene, scene.pen)
  scene.hitBoxes = []
  scene.lights = []
  drawWindows(scene)
  drawClock(scene)
  drawWhiteboard(scene)
  drawPoster(scene)
  drawNapSign(scene)
  const ownerOfDesk = new Map(), robotOfRack = new Map()
  for (const person of scene.people.values()) {
    if (person.kind === 'session' && person.desk) ownerOfDesk.set(person.sessionId, person)
    if (person.kind === 'robot' && scene.rackOf.has(person.sessionId)) robotOfRack.set(scene.rackOf.get(person.sessionId), person)
  }
  const { utilityX, corridorY, floorWidth } = scene.layout
  const drawables = []
  drawables.push({ depth: 1.2, paint: () => drawLounge(scene) })
  drawables.push({ depth: 0.35 + 4.2, paint: () => drawWaterCooler(scene, 0.35, 4.2) })
  drawables.push({ depth: 4.4 + 2.05, paint: () => drawFloorLamp(scene, 4.4, 2.05) })
  drawables.push({ depth: 1.55 + 3.42 + 1.2, paint: () => drawPingPong(scene) })
  // The snooker table sorts by its front edge, so the player behind it is drawn first.
  const snooker = scene.layout.snooker
  drawables.push({ depth: snooker.gx + snooker.gy + snooker.depth + 0.6, paint: () => drawSnooker(scene) })
  drawables.push(...napRoomDrawables(scene))
  drawables.push({ depth: 4.5 + 0.45, paint: () => drawTallPlant(scene, 4.5, 0.45) })
  drawables.push({ depth: 0.45 + corridorY - 1.1, paint: () => drawPlant(scene, 0.45, corridorY - 1.1, 0.9) })
  drawables.push({ depth: floorWidth - 0.45 + corridorY - 0.3, paint: () => drawTallPlant(scene, floorWidth - 0.45, corridorY - 0.3) })
  drawables.push({ depth: utilityX + 0.1 + 0.48, paint: () => drawBookshelf(scene) })
  drawables.push({ depth: scene.layout.globe.gx + scene.layout.globe.gy, paint: () => drawGlobe(scene) })
  drawables.push({ depth: scene.layout.printer.gx + scene.layout.printer.gy + 0.9, paint: () => drawPrinter(scene) })
  drawables.push({ depth: scene.layout.shredder.gx + scene.layout.shredder.gy + 0.6, paint: () => drawShredder(scene) })
  for (const [sessionId, desk] of scene.layout.deskBySession) {
    const owner = ownerOfDesk.get(sessionId)
    drawables.push({ depth: desk.gx + desk.gy + 0.36, paint: () => drawDesk(scene, desk, owner) })
    drawables.push({ depth: desk.gx + desk.gy + 0.9, paint: () => drawChair(scene, desk, 'seat') })
    drawables.push({ depth: desk.gx + desk.gy + 1.12, paint: () => drawChair(scene, desk, 'back') })
  }
  scene.layout.racks.forEach((rack, index) => drawables.push({ depth: rack.gx + rack.gy + 0.3, paint: () => drawRack(scene, rack, robotOfRack.get(index)) }))
  for (const person of scene.people.values()) {
    const seated = !person.path.length && person.target.pose === 'sit'
    drawables.push({ depth: person.gx + person.gy + (seated ? 0.01 : 0.05), paint: () => drawPerson(scene, person) })
  }
  drawables.sort((first, second) => first.depth - second.depth)
  for (const item of drawables) item.paint()
  drawEffects(scene)
  applyLighting(scene)
  worldTransform(scene, scene.pen)
  drawVignette(scene)
  drawOverlays(scene)
}
function step(scene, seconds) {
  scene.clockSeconds += seconds
  const now = Date.now()
  if (scene.cameraReturnAt && now > scene.cameraReturnAt) { scene.cameraReturnAt = 0; scene.cameraGoal = { zoom: 1, x: 0, y: 0 } }
  const ease = Math.min(1, seconds * 3.5)
  scene.camera = { zoom: scene.camera.zoom + (scene.cameraGoal.zoom - scene.camera.zoom) * ease, x: scene.camera.x + (scene.cameraGoal.x - scene.camera.x) * ease, y: scene.camera.y + (scene.cameraGoal.y - scene.camera.y) * ease }
  for (const person of [...scene.people.values()]) {
    if (person.path.length) {
      const next = person.path[0]
      const deltaX = next.gx - person.gx, deltaY = next.gy - person.gy
      const distance = Math.hypot(deltaX, deltaY)
      const stride = WALK_SPEED * seconds * (person.kind === 'helper' ? 1.15 : 1)
      if (distance <= stride) { person.gx = next.gx; person.gy = next.gy; person.path.shift() } else { person.gx += (deltaX / distance) * stride; person.gy += (deltaY / distance) * stride }
    }
    if (person.leaving) {
      if (!person.path.length) person.alpha -= seconds * 3
      if (person.alpha <= 0) removePerson(scene, person)
      continue
    }
    if (person.alpha < 1) person.alpha = Math.min(1, person.alpha + seconds * 2.5)
    runErrand(scene, person, now)
    maybeStartErrand(scene, person, seconds)
  }
}
function frame(scene, now) {
  scene.frameId = 0
  const seconds = scene.lastFrameAt ? Math.min(0.06, (now - scene.lastFrameAt) / 1000) : 0
  scene.lastFrameAt = now
  step(scene, seconds)
  draw(scene)
  if (shouldAnimate(scene)) scene.frameId = requestAnimationFrame(time => frame(scene, time))
  else scene.lastFrameAt = 0
}
const shouldAnimate = scene => scene.isActive && document.visibilityState === 'visible' && !isReduced(scene)
export function wake(scene) {
  if (!scene.isActive || document.visibilityState !== 'visible') return
  if (isReduced(scene)) { settleAll(scene); draw(scene); return }
  if (!scene.frameId) scene.frameId = requestAnimationFrame(time => frame(scene, time))
}
export function settleAll(scene) {
  // Without motion everyone is simply where they belong.
  for (const person of [...scene.people.values()]) {
    if (person.leaving) { removePerson(scene, person); continue }
    person.errand = null
    person.carrying = ''
    if (person.path.length) { const last = person.path[person.path.length - 1]; person.gx = last.gx; person.gy = last.gy; person.path = [] }
    person.alpha = 1
  }
  scene.effects = []
  scene.camera = { ...scene.cameraGoal }
}
function removePerson(scene, person) {
  scene.people.delete(person.key)
  if (person.kind === 'robot' && !scene.liveIds.has(person.sessionId)) scene.rackOf.delete(person.sessionId)
}
