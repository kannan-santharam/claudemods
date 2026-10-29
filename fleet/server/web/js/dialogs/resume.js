import { api } from '../core/api.js'
import { $, toast } from '../core/dom.js'
import { ago, esc, shortModel } from '../core/format.js'
import { state } from '../core/state.js'
import { remember, remembered } from '../core/storage.js'
import { createPicker, rememberFolder } from './picker.js'
import { runMode, showRunMode, startedToast } from './run-mode.js'
import { refreshLive } from '../refresh.js'
import { focusTab, loadOptions } from '../sessions/actions.js'

// ---------------------------------------------------------- resume dialog --
const resumePicker = createPicker($('#resume-picker'), picker => { remember('fleet-resume-folder', picker.path); loadHistory() })
const resume = { sessions: [], chosen: '' }
function renderHistory() {
  const filter = $('#resume-search').value.trim().toLowerCase()
  const list = resume.sessions.filter(s => !filter || (s.name + ' ' + s.firstPrompt + ' ' + s.lastPrompt).toLowerCase().includes(filter))
  $('#resume-list').innerHTML = list.map(s => `
    <div class="item ${s.isLive ? 'live' : ''}" role="option" data-resume="${esc(s.sessionId)}" aria-selected="${resume.chosen === s.sessionId}">
      <span class="title">${esc(s.name)}</span>
      <span class="meta">${s.isLive ? '<b>running</b> · ' : ''}${ago(s.lastAt)} ago${s.model ? ' · ' + esc(shortModel(s.model)) : ''}</span>
      <span class="snippet">${s.subfolder ? `<code>${esc(s.subfolder)}</code> · ` : ''}Last: ${esc(s.lastPrompt || s.firstPrompt)}</span>
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
    $('#closed-list').innerHTML = closed.map(s => `
      <div class="item">
        <span class="title">${esc(s.name)}</span>
        <span class="meta">${esc(s.folder)} · closed ${ago(s.endedAt)} ago${s.model ? ' · ' + esc(shortModel(s.model)) : ''}</span>
        <button type="button" class="btn small primary" data-resume-closed="${esc(s.sessionId)}">Resume</button>
        <span class="snippet">${s.lastPrompt ? 'Last: ' + esc(s.lastPrompt) : '&nbsp;'}</span>
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
  $('#resume-model').innerHTML = options.models.map(m => `<option value="${esc(m.id)}">${esc(m.id ? m.label : 'Keep its model')}</option>`).join('')
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
    const session = resume.sessions.find(s => s.sessionId === item.dataset.resume)
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
