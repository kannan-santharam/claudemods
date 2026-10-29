// The Office tab: every session as a person in an isometric office, drawn on a
// canvas with no image assets. Sessions sit with their project: each folder is
// a row of desks on its own coloured rug. A working session sits at its desk
// and its screen shows what it is doing (code for edits, a page for reads, a
// terminal for commands), with a paper pile that grows with its context; one
// waiting for you stands up with a "!"; idle ones are in the lounge, on the
// sofa, at the ping-pong table or fetching coffee. What a session wears says
// which model it runs. Commits fly to the outbox as parcels, pushes leave by
// the window as paper planes and a compaction is a trip to the shredder.
// Running subagents are small helpers on stools beside their session, and a
// headless session started by another is a robot at the server racks. The
// room is lit by the local time of day, and the dark theme is night.
//
// This module builds the office from its parts, which share one scene object
// (scene.js), and hands the rest of the page a small handle.

import { refreshColors } from './colors.js'
import { draw, settleAll, wake } from './frame.js'
import { hashOf } from './helpers.js'
import { buildLayout } from './layout.js'
import { drawMini } from './mini.js'
import { bindPointer } from './pointer.js'
import { createScene, isReduced } from './scene.js'
import { sync } from './sync.js'
import { renderTicker } from './ticker.js'
import { bindToolbar } from './toolbar.js'

function createOffice(page) {
  const scene = createScene(buildLayout([], 0))
  bindPointer(scene, page)
  bindToolbar(scene)
  new ResizeObserver(() => { if (scene.isActive) draw(scene) }).observe(scene.canvas.parentElement)
  document.addEventListener('visibilitychange', () => wake(scene))
  scene.motionQuery.addEventListener('change', () => { settleAll(scene); renderTicker(scene); wake(scene) })
  // The clock, the sky and relative times in the ticker move even when nothing else does.
  setInterval(() => { renderTicker(scene); if (scene.isActive && isReduced(scene)) draw(scene) }, 30_000)

  return {
    sync: live => sync(scene, live),
    drawMini: target => drawMini(scene, target),
    setActive(next) {
      scene.isActive = next
      if (next) { scene.lastFrameAt = 0; if (isReduced(scene)) settleAll(scene); draw(scene); wake(scene) } else if (scene.frameId) { cancelAnimationFrame(scene.frameId); scene.frameId = 0; scene.lastFrameAt = 0 }
    },
    themeChanged() {
      refreshColors(scene)
      scene.floorCacheKey = ''
      for (const person of scene.people.values()) if (person.kind !== 'helper') person.shirt = scene.colors.shirts[hashOf(person.key) % scene.colors.shirts.length]
      for (const segment of scene.layout.segments) segment.color = scene.colors.shirts[hashOf(segment.key) % scene.colors.shirts.length]
      if (scene.isActive) draw(scene)
    },
    get isAnimating() { return Boolean(scene.frameId) },
  }
}

// Built once by main.js, at its place in the start-up order: it reads the DOM,
// adds its listeners and starts its timer. page is what a click in the office
// opens elsewhere on the page: { setTab, renderLive, focusTab }.
export let office = null
export function startOffice(page) {
  office = createOffice(page)
  // The screenshot and demo harnesses call office.themeChanged() and office.drawMini().
  window.office = office
}
