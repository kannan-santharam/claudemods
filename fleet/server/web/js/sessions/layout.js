// Switching between the List and Table views, where the headline figures sit,
// the small office preview, and sizing the split to the window.

import { $ } from '../core/dom.js'
import { state } from '../core/state.js'
import { remember } from '../core/storage.js'
import { office } from '../office.js'
import { isListView } from './list-view.js'
import { renderLive } from './live.js'

// List or Table, remembered in this browser. The headline figures sit in the List
// view's right column when it is showing, and above the tabs otherwise.
export const wideQuery = matchMedia('(min-width: 1280px)')
export function placeTiles() {
  const tiles = $('#tiles')
  const inSide = isListView() && !$('#view-sessions').hidden && wideQuery.matches
  if (inSide && tiles.parentElement.id !== 'side-tiles') $('#side-tiles').appendChild(tiles)
  else if (!inSide && tiles.parentElement.id === 'side-tiles') document.querySelector('.tabs').before(tiles)
  fitSplit()
}
export function setView(view) {
  state.view = view === 'table' ? 'table' : 'list'
  remember('fleet-sessions-view', state.view)
  $('#view-sessions').dataset.layout = state.view
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)))
  placeTiles()
  renderLive()
  drawOfficeMini()
}
// The small office in the List view: one still frame of the real scene, redrawn
// with each refresh while it is on screen. No animation loop of its own.
export function drawOfficeMini() {
  const mini = $('#office-mini')
  if (!isListView() || $('#view-sessions').hidden || document.visibilityState !== 'visible' || !mini.clientWidth) return
  const sessions = state.live?.sessions || []
  const waiting = sessions.filter(session => session.status === 'waiting').length
  $('#office-mini-hint').textContent = waiting ? `${waiting} waiting for you` : `${sessions.filter(session => session.status === 'busy').length} at their desks`
  office.drawMini(mini)
}
// The split fills the window below the header and the figures.
export function fitSplit() {
  const split = document.querySelector('.split')
  if (!split || $('#view-sessions').hidden) return
  document.documentElement.style.setProperty('--split-top', Math.round(split.getBoundingClientRect().top + scrollY) + 'px')
}

export function initLayout() {
  addEventListener('resize', fitSplit)
}
