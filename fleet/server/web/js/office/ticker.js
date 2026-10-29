// The ticker under the office: what just happened, newest first, and the
// chime that sounds when someone starts waiting for you (when Chime is on).

import { $ } from '../core/dom.js'
import { escapeHtml, timeAgo } from '../core/format.js'
import { isReduced, isWallMode } from './scene.js'

export function addEvent(scene, text, kind, sessionId) {
  scene.events.unshift({ at: Date.now(), text, kind, sessionId })
  scene.events.length = Math.min(scene.events.length, 40)
}
export function renderTicker(scene) {
  const holder = $('#office-ticker')
  if (!holder) return
  const recent = scene.events.slice(0, isWallMode(scene) ? 12 : 6)
  if (!recent.length) { holder.innerHTML = '<span class="ticker-empty">Things that happen in the office show up here: someone needing you, commits, pushes, compactions, people coming and going.</span>'; return }
  const items = recent.map(event => `<span class="ticker-item kind-${event.kind}"><b>${escapeHtml(event.text)}</b> <i>${escapeHtml(timeAgo(event.at))}</i></span>`).join('')
  holder.innerHTML = isWallMode(scene) && !isReduced(scene) ? `<span class="ticker-track">${items}${items}</span>` : items
}
export function chime(scene) {
  if (!scene.soundOn) return
  try {
    scene.audio = scene.audio || new AudioContext()
    const start = scene.audio.currentTime
    ;[660, 880].forEach((frequency, index) => {
      const oscillator = scene.audio.createOscillator(), gain = scene.audio.createGain()
      const noteAt = start + index * 0.16
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, noteAt)
      gain.gain.exponentialRampToValueAtTime(0.16, noteAt + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, noteAt + 0.5)
      oscillator.connect(gain).connect(scene.audio.destination)
      oscillator.start(noteAt)
      oscillator.stop(noteAt + 0.55)
    })
  } catch {}
}
