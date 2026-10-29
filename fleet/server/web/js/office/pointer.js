// The pointer on the office canvas: what is under it, the tooltip that
// describes a person, dragging the zoomed room, ctrl or pinch to zoom, a click
// that opens the session in the list and a double click that opens its tab.

import { shortModel, timeAgo } from '../core/format.js'
import { sessionById, state } from '../core/state.js'
import { focusTab } from '../sessions/actions.js'
import { isListView } from '../sessions/list-view.js'
import { renderLive } from '../sessions/live.js'
import { STATUS } from '../sessions/tree.js'
import { setTab } from '../tabs.js'
import { tip } from '../tooltip.js'
import { setCamera, zoomAround } from './camera.js'
import { ACTIVITY_LABEL, OUTFIT_LABEL, TRIP_LABEL } from './constants.js'
import { draw } from './frame.js'
import { truncate } from './helpers.js'
import { isReduced, isWallMode } from './scene.js'

function hitAt(scene, event) {
  const bounds = scene.canvas.getBoundingClientRect()
  const worldX = (event.clientX - bounds.left - scene.view.offsetX) / scene.view.scale
  const worldY = (event.clientY - bounds.top - scene.view.offsetY) / scene.view.scale
  for (let index = scene.hitBoxes.length - 1; index >= 0; index--) {
    const box = scene.hitBoxes[index]
    if (worldX >= box.x && worldX <= box.x + box.width && worldY >= box.y && worldY <= box.y + box.height) return scene.people.get(box.key)
  }
  return null
}
function describe(scene, person) {
  const session = person.session
  if (!session) return person.label || ''
  if (person.kind === 'helper') {
    const agent = person.agent
    return `${agent.description}\n${agent.agentType || 'Subagent'} helping ${session.name}\nRunning for ${timeAgo(agent.startedAt)}\nClick to open ${session.name}`
  }
  const statusLabel = STATUS[session.status]?.label || session.status
  const doing = person.trip ? TRIP_LABEL[person.trip.kind] : person.errand?.kind === 'shred' ? 'shredding its old context' : ACTIVITY_LABEL[person.activity] || person.activity
  const status = person.leaving ? 'Session ended' : person.activity === 'waiting' ? statusLabel + (person.isUrgent ? ` for ${timeAgo(scene.waitingSince.get(session.sessionId))}` : '') : `${statusLabel} · ${doing}`
  const helpers = session.subagents.filter(agent => agent.isRunning).length
  const shells = session.shells || []
  return [
    session.name,
    status,
    `${shortModel(session.model) || 'model unknown'}${person.outfit ? ' · ' + OUTFIT_LABEL[person.outfit] : ''} · context ${session.contextPercent}%`,
    session.folder + (session.branch ? ` · ${session.branch}` : ''),
    helpers ? `${helpers} helper${helpers > 1 ? 's' : ''} running` : '',
    shells.length ? `${shells.length} background shell${shells.length > 1 ? 's' : ''}: ${shells.slice(0, 3).map(shell => truncate(shell.description || shell.command, 34)).join(', ')}${shells.length > 3 ? '…' : ''}` : '',
    session.hidden ? `Hidden · ${session.jobId} · reached only from this page` : '',
    person.kind === 'robot' ? (sessionById(session.parentSessionId) ? `Headless, started by ${sessionById(session.parentSessionId).name}` : 'Headless session, no terminal tab') : '',
    person.leaving ? '' : session.tty ? 'Click for details · double-click for its tab' : 'Click for details',
  ].filter(Boolean).join('\n')
}
function openInList(scene, sessionId) {
  tip.style.display = 'none'
  if (isWallMode(scene)) document.exitFullscreen().catch(() => {})
  state.open = new Set([sessionId])
  state.filter = 'all'
  let parent = sessionById(sessionId)?.parentSessionId
  for (let depth = 0; parent && depth < 6; depth++) { state.collapsed.delete(parent); parent = sessionById(parent)?.parentSessionId }
  setTab('sessions')
  renderLive()
  const row = document.querySelector(isListView() ? `.nav-item[data-id="${CSS.escape(sessionId)}"]` : `tr.session[data-id="${CSS.escape(sessionId)}"]`)
  if (row) { row.scrollIntoView({ block: 'center', behavior: isReduced(scene) ? 'auto' : 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600) }
}
// The canvas listeners. A drag that moved sets scene.suppressClick on mouseup,
// which comes before the click that ends the drag, so that click selects no one.
export function bindPointer(scene) {
  scene.canvas.addEventListener('mousedown', event => {
    if (event.button !== 0 || scene.camera.zoom <= 1.01) return
    scene.drag = { x: event.clientX, y: event.clientY, cameraX: scene.camera.x, cameraY: scene.camera.y, moved: false }
  })
  window.addEventListener('mouseup', () => { if (scene.drag?.moved) scene.suppressClick = true; scene.drag = null; scene.canvas.classList.remove('dragging') })
  scene.canvas.addEventListener('mousemove', event => {
    if (scene.drag) {
      const deltaX = event.clientX - scene.drag.x, deltaY = event.clientY - scene.drag.y
      if (!scene.drag.moved && Math.hypot(deltaX, deltaY) > 4) { scene.drag.moved = true; scene.canvas.classList.add('dragging'); tip.style.display = 'none' }
      if (scene.drag.moved) { scene.cameraReturnAt = 0; setCamera(scene, { zoom: scene.camera.zoom, x: scene.drag.cameraX - deltaX / scene.view.scale, y: scene.drag.cameraY - deltaY / scene.view.scale }, true); return }
    }
    const person = hitAt(scene, event)
    const key = person ? person.key : ''
    if (key !== scene.hoveredKey) { scene.hoveredKey = key; if (isReduced(scene)) draw(scene) }
    scene.canvas.style.cursor = person && !person.leaving ? 'pointer' : scene.camera.zoom > 1.01 ? 'grab' : 'default'
    if (!person) { tip.style.display = 'none'; return }
    tip.textContent = describe(scene, person)
    tip.style.display = 'block'
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 14) + 'px'
    tip.style.top = Math.min(window.innerHeight - tip.offsetHeight - 8, event.clientY + 16) + 'px'
  })
  scene.canvas.addEventListener('mouseleave', () => { scene.hoveredKey = ''; tip.style.display = 'none'; if (isReduced(scene)) draw(scene) })
  // Pinch on a trackpad, or ctrl and the wheel, zooms around the pointer.
  scene.canvas.addEventListener('wheel', event => {
    if (!event.ctrlKey && !isWallMode(scene)) return
    event.preventDefault()
    const bounds = scene.canvas.getBoundingClientRect()
    zoomAround(scene, scene.camera.zoom * Math.exp(-event.deltaY * 0.01), event.clientX - bounds.left, event.clientY - bounds.top)
  }, { passive: false })
  scene.canvas.addEventListener('click', event => {
    if (scene.suppressClick) { scene.suppressClick = false; return }
    const person = hitAt(scene, event)
    if (!person || person.leaving || !person.sessionId) return
    clearTimeout(scene.clickTimer)
    scene.clickTimer = setTimeout(() => openInList(scene, person.sessionId), 260)
  })
  scene.canvas.addEventListener('dblclick', event => {
    clearTimeout(scene.clickTimer)
    const person = hitAt(scene, event)
    if (!person || person.leaving || !person.sessionId) return
    const session = sessionById(person.sessionId)
    if (session?.tty) focusTab(session.sessionId)
    else openInList(scene, person.sessionId)
  })
}
