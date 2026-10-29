// The office toolbar: Snapshot and Record clip save what the canvas shows,
// Wall mode puts the office full screen, the zoom buttons move the camera,
// and the Names and Chime toggles are remembered in this browser.

import { $, toast } from '../core/dom.js'
import { remember } from '../core/storage.js'
import { tip } from '../tooltip.js'
import { setCamera, zoomAround } from './camera.js'
import { draw, wake } from './frame.js'
import { isReduced, isWallMode } from './scene.js'
import { chime, renderTicker } from './ticker.js'

const stamp = () => { const date = new Date(); const twoDigits = value => String(value).padStart(2, '0'); return `${date.getFullYear()}${twoDigits(date.getMonth() + 1)}${twoDigits(date.getDate())}-${twoDigits(date.getHours())}${twoDigits(date.getMinutes())}` }
function download(blob, name) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 4000)
}
function snapshot(scene) {
  tip.style.display = 'none'
  scene.hoveredKey = ''
  draw(scene)
  scene.canvas.toBlob(blob => { if (blob) { download(blob, `fleet-office-${stamp()}.png`); toast(scene.showNames ? 'Snapshot saved. It shows session and project names; turn off Names first to leave them out.' : 'Snapshot saved without names.') } }, 'image/png')
}
function recordClip(scene) {
  if (scene.recorder) return
  const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(candidate => window.MediaRecorder?.isTypeSupported?.(candidate))
  if (!scene.canvas.captureStream || !type) { toast('This browser cannot record the canvas. Try a snapshot instead.'); return }
  const button = $('#office-clip')
  const chunks = []
  scene.recorder = new MediaRecorder(scene.canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6_000_000 })
  scene.recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
  scene.recorder.onstop = () => {
    scene.recorder = null
    button.textContent = 'Record clip'
    button.disabled = false
    download(new Blob(chunks, { type: 'video/webm' }), `fleet-office-${stamp()}.webm`)
    toast(scene.showNames ? 'Clip saved. It shows session and project names; turn off Names first to leave them out.' : 'Clip saved without names.')
  }
  tip.style.display = 'none'
  scene.hoveredKey = ''
  wake(scene)
  scene.recorder.start()
  button.disabled = true
  let left = 8
  button.textContent = `Recording ${left}s`
  const timer = setInterval(() => {
    left--
    if (left > 0) { button.textContent = `Recording ${left}s`; return }
    clearInterval(timer)
    scene.recorder.stop()
  }, 1000)
}
function toggleWallMode(scene) {
  if (isWallMode(scene)) { document.exitFullscreen().catch(() => {}); return }
  if (!scene.card.requestFullscreen) { toast('Full screen is not available in this browser.'); return }
  scene.card.requestFullscreen().catch(error => toast('Full screen was refused: ' + error.message))
}
// The toolbar's listeners, and the toggles set from what this browser remembered.
export function bindToolbar(scene) {
  document.addEventListener('fullscreenchange', () => {
    const isWall = isWallMode(scene)
    $('#office-wall').textContent = isWall ? 'Exit wall mode' : 'Wall mode'
    scene.cameraGoal = { zoom: 1, x: 0, y: 0 }
    scene.camera = { ...scene.cameraGoal }
    scene.cameraReturnAt = 0
    scene.floorCacheKey = ''
    renderTicker(scene)
    if (scene.isActive) { draw(scene); wake(scene) }
  })
  $('#office-names').checked = scene.showNames
  $('#office-names').addEventListener('change', event => {
    scene.showNames = event.target.checked
    remember('fleet-office-names', scene.showNames ? 'on' : 'off')
    if (isReduced(scene)) draw(scene)
  })
  $('#office-chime').checked = scene.soundOn
  $('#office-chime').addEventListener('change', event => {
    scene.soundOn = event.target.checked
    remember('fleet-office-chime', scene.soundOn ? 'on' : 'off')
    if (scene.soundOn) chime(scene)
  })
  $('#office-snapshot').addEventListener('click', () => snapshot(scene))
  $('#office-clip').addEventListener('click', () => recordClip(scene))
  $('#office-wall').addEventListener('click', () => toggleWallMode(scene))
  $('#office-zoom-in').addEventListener('click', () => zoomAround(scene, scene.camera.zoom * 1.35, scene.view.cssWidth / 2, scene.view.cssHeight / 2))
  $('#office-zoom-out').addEventListener('click', () => zoomAround(scene, scene.camera.zoom / 1.35, scene.view.cssWidth / 2, scene.view.cssHeight / 2))
  $('#office-zoom-fit').addEventListener('click', () => { scene.cameraReturnAt = 0; setCamera(scene, { zoom: 1, x: 0, y: 0 }) })
}
