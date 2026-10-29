// Ending sessions: the bar above the table for a selection, and the dialog
// that confirms (and, when a session will not stop, offers to force it).

import { api } from '../core/api.js'
import { $, toast } from '../core/dom.js'
import { escapeHtml } from '../core/format.js'
import { sessionById, state } from '../core/state.js'
import { refreshLive } from '../refresh.js'
import { renderLive } from '../sessions/live.js'

// One session from its row, or every selected one from the bar above the table.
const ending = { sessionIds: [], force: false }
export function renderBulkbar() {
  const count = state.selected.size
  $('#bulkbar').hidden = count === 0
  $('#bulk-count').textContent = `${count} session${count === 1 ? '' : 's'} selected`
}
export function askToEnd(sessionIds, force = false) {
  const list = (Array.isArray(sessionIds) ? sessionIds : [sessionIds]).map(sessionById).filter(Boolean)
  if (!list.length) return
  ending.sessionIds = list.map(session => session.sessionId)
  ending.force = force
  const ids = new Set(ending.sessionIds)
  const children = (state.live?.sessions || []).filter(session => ids.has(session.parentSessionId) && !ids.has(session.sessionId)).length
  const busy = list.filter(session => session.status === 'busy').length
  const many = list.length > 1
  const subject = many ? `${list.length} sessions` : list[0].name
  $('#end-title').textContent = force ? `Force-end ${subject}?` : `End ${subject}?`
  $('#end-text').textContent = (force
    ? `${many ? 'They' : 'It'} did not stop when asked. Forcing stops ${many ? 'them' : 'it'} at once; anything being written at that moment may be lost.`
    : `This stops ${many ? 'these Claude sessions' : 'the Claude session'}${busy ? ` (${busy === list.length && !many ? 'it is' : busy + ' are'} in the middle of work)` : ''} and closes ${many ? 'their terminal tabs' : list[0].hidden ? 'it in the background' : 'its terminal tab'}. Conversations are kept, so you can bring them back later with Resume session.`) +
    (children ? ` The ${children} session${children > 1 ? 's' : ''} they started keep running.` : '')
  $('#end-list').hidden = !many
  $('#end-list').innerHTML = many ? list.map(session => `<li>${escapeHtml(session.name)}</li>`).join('') : ''
  $('#end-confirm').textContent = force ? 'Force end' : many ? `End ${list.length} sessions` : 'End session'
  $('#end-dialog').hidden = false
  $('#end-cancel').focus()
}
function closeEndDialog() { $('#end-dialog').hidden = true }

export function initEndSessionDialog() {
  $('#bulk-clear').addEventListener('click', () => { state.selected.clear(); renderLive() })
  $('#bulk-end').addEventListener('click', () => askToEnd([...state.selected]))
  $('#end-cancel').addEventListener('click', closeEndDialog)
  $('#end-dialog').addEventListener('click', event => { if (event.target.id === 'end-dialog') closeEndDialog() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#end-dialog').hidden) closeEndDialog() })
  $('#end-confirm').addEventListener('click', async () => {
    const { sessionIds, force } = ending
    const button = $('#end-confirm')
    button.disabled = true
    const ended = [], stillRunning = [], failed = [], tabNotes = []
    try {
      // One at a time: each waits for its process to exit before the next.
      for (const sessionId of sessionIds) {
        try {
          const result = await api('/api/end', { sessionId, force })
          if (result.ok) { ended.push(sessionId); if (result.tabNote) tabNotes.push(result.tabNote) }
          else if (result.stillRunning) stillRunning.push(sessionId)
          else failed.push(result.reason)
        } catch (error) { failed.push(error.message) }
      }
    } finally { button.disabled = false }
    closeEndDialog()
    for (const sessionId of ended) { state.open.delete(sessionId); state.selected.delete(sessionId) }
    const parts = []
    if (ended.length) parts.push(ended.length === 1 && sessionIds.length === 1 ? `${sessionById(ended[0])?.name || 'The session'} ended` : `${ended.length} ended`)
    if (tabNotes.length) parts.push(`its tab stayed open: ${tabNotes[0]}`)
    if (failed.length) parts.push(`${failed.length} not ended: ${failed[0]}`)
    if (parts.length) toast(parts.join(' · '))
    refreshLive()
    if (stillRunning.length) askToEnd(stillRunning, true)
  })
}
