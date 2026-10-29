// Keyboard: j and k move through the sessions, Escape closes the actions menu.

import { $ } from '../core/dom.js'
import { state } from '../core/state.js'
import { renderLive, selectSession } from './live.js'

export function initKeyboard() {
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && state.actionsMenu) { state.actionsMenu = ''; renderLive(); return }
    if (event.metaKey || event.ctrlKey || event.altKey || !$('#view-reports').hidden || !$('#view-office').hidden) return
    if (event.target.closest('input, textarea, select, [contenteditable]') || !(event.key === 'j' || event.key === 'k')) return
    const list = state.visible
    if (!list.length) return
    const currentIndex = list.indexOf([...state.open][0])
    const next = list[Math.max(0, Math.min(list.length - 1, currentIndex + (event.key === 'j' ? 1 : -1)))]
    if (next) { event.preventDefault(); selectSession(next) }
  })
}
