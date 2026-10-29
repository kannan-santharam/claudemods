// The Resume session dialog: recently closed sessions, or a past one from a
// folder.

import { api } from '../core/api.js'
import { $, toast } from '../core/dom.js'
import { escapeHtml, shortModel, timeAgo } from '../core/format.js'
import { state } from '../core/state.js'
import { remember, remembered } from '../core/storage.js'
import { createPicker, rememberFolder } from './picker.js'
import { runMode, showRunMode, startedToast } from './run-mode.js'
import { refreshLive } from '../refresh.js'
import { focusTab, loadOptions } from '../sessions/actions.js'

const resumePicker = createPicker($('#resume-picker'), picker => { remember('fleet-resume-folder', picker.path); loadHistory() })
const resume = { sessions: [], chosen: '' }
function renderHistory() {
  const filter = $('#resume-search').value.trim().toLowerCase()
  const list = resume.sessions.filter(session => !filter || (session.name + ' ' + session.firstPrompt + ' ' + session.lastPrompt).toLowerCase().includes(filter))
  $('#resume-list').innerHTML = list.map(session => `
    <div class="item ${session.isLive ? 'live' : ''}" role="option" data-resume="${escapeHtml(session.sessionId)}" aria-selected="${resume.chosen === session.sessionId}">
      <span class="title">${escapeHtml(session.name)}</span>
      <span class="meta">${session.isLive ? '<b>running</b> · ' : ''}${timeAgo(session.lastAt)} ago${session.model ? ' · ' + escapeHtml(shortModel(session.model)) : ''}</span>
      <span class="snippet">${session.subfolder ? `<code>${escapeHtml(session.subfolder)}</code> · ` : ''}Last: ${escapeHtml(session.lastPrompt || session.firstPrompt)}</span>
    </div>`).join('') || `<div class="empty">${resume.sessions.length ? 'Nothing matches the filter' : 'No past sessions in this folder'}</div>`
  $('#resume-start').disabled = !resume.chosen
}
async function loadHistory() {
  resume.chosen = ''
  $('#resume-list').innerHTML = '<div class="empty">Loading…</div>'
  $('#resume-start').disabled = true
  try {
    if (!resumePicker.path) return
    const result = await api('/api/history?folder=' + encodeURIComponent(resumePicker.path))
    resume.sessions = result.ok ? result.sessions : []
    if (!result.ok) toast(result.reason)
  } catch (error) { resume.sessions = []; toast(error.message) }
  renderHistory()
}
// The last ten sessions that closed, each one click from coming back.
async function loadRecentlyClosed() {
  try {
    const result = await api('/api/recently-closed')
    const closed = result.sessions || []
    $('#closed-section').hidden = !closed.length
    $('#closed-list').innerHTML = closed.map(session => `
      <div class="item">
        <span class="title">${escapeHtml(session.name)}</span>
        <span class="meta">${escapeHtml(session.folder)} · closed ${timeAgo(session.endedAt)} ago${session.model ? ' · ' + escapeHtml(shortModel(session.model)) : ''}</span>
        <button type="button" class="btn small primary" data-resume-closed="${escapeHtml(session.sessionId)}">Resume</button>
        <span class="snippet">${session.lastPrompt ? 'Last: ' + escapeHtml(session.lastPrompt) : '&nbsp;'}</span>
      </div>`).join('')
  } catch { $('#closed-section').hidden = true }
}
async function resumeSession(sessionId, button) {
  if (button) button.disabled = true
  try {
    const result = await api('/api/resume', { sessionId, model: $('#resume-model').value, hidden: runMode() === 'hidden' })
    if (!result.ok) return toast(result.reason)
    closeResumeDialog()
    startedToast(result, 'Resumed')
    setTimeout(refreshLive, 4000)
  } catch (error) { toast(error.message) } finally { if (button) button.disabled = false }
}
async function openResumeDialog() {
  await loadOptions()
  loadRecentlyClosed()
  const options = state.options || { folders: [], models: [] }
  $('#resume-model').innerHTML = options.models.map(model => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.id ? model.label : 'Keep its model')}</option>`).join('')
  $('#resume-search').value = ''
  showRunMode('resume-run')
  $('#resume-dialog').hidden = false
  $('#resume-search').focus()
  await resumePicker.go(remembered('fleet-resume-folder'))
}
function closeResumeDialog() { $('#resume-dialog').hidden = true }

export function initResumeDialog() {
  $('#closed-list').addEventListener('click', event => {
    const button = event.target.closest('[data-resume-closed]')
    if (button) resumeSession(button.dataset.resumeClosed, button)
  })
  $('#resume-session').addEventListener('click', openResumeDialog)
  $('#resume-cancel').addEventListener('click', closeResumeDialog)
  $('#resume-dialog').addEventListener('click', event => { if (event.target.id === 'resume-dialog') closeResumeDialog() })

  $('#resume-search').addEventListener('input', renderHistory)
  $('#resume-list').addEventListener('click', event => {
    const item = event.target.closest('[data-resume]')
    if (!item) return
    const session = resume.sessions.find(candidate => candidate.sessionId === item.dataset.resume)
    if (!session) return
    if (session.isLive) { closeResumeDialog(); return focusTab(session.sessionId) }
    resume.chosen = session.sessionId
    renderHistory()
  })
  $('#resume-list').addEventListener('dblclick', event => {
    const item = event.target.closest('[data-resume]')
    if (item && !item.classList.contains('live')) $('#resume-form').requestSubmit()
  })
  $('#resume-form').addEventListener('submit', async event => {
    event.preventDefault()
    if (!resume.chosen) return
    const button = $('#resume-start')
    button.disabled = true
    try {
      rememberFolder(resumePicker.path)
      await resumeSession(resume.chosen)
    } finally { button.disabled = !resume.chosen }
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#resume-dialog').hidden) closeResumeDialog() })
}
