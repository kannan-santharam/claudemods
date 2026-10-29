import { $, toast } from '../core/dom.js'
import { fieldValue, sessionById, state } from '../core/state.js'
import { askToCompact } from '../dialogs/compact.js'
import { askToEnd } from '../dialogs/end-session.js'
import { askToSwitchModel } from '../dialogs/switch-model.js'
import { attachHidden, focusTab, sendFromDraft, sessionCommand } from './actions.js'
import { answerAsk, pickOption } from './asks.js'
import { drawOfficeMini, placeTiles, setView, wideQuery } from './layout.js'
import { renderLive, selectSession } from './live.js'
import { refreshScreens } from './screen.js'
import { setTab } from '../tabs.js'

export function initSessionEvents() {
  // A click anywhere outside the actions menu closes it.
  document.addEventListener('click', event => {
    if (state.actionsMenu && !event.target.closest('.actions-menu')) { state.actionsMenu = ''; renderLive() }
  })
  $('#view-sessions').addEventListener('click', event => {
    const target = event.target
    // dataset keys are camelCase; their attributes are kebab-case (applyModel → data-apply-model).
    const attr = name => target.closest(`[data-${name.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())}]`)?.dataset[name]
    const focusId = attr('focus'), messageId = attr('message'), sendId = attr('send'), selectId = attr('select')
    const compactId = attr('compact')
    if (compactId) return askToCompact(compactId)
    const endId = attr('end')
    if (endId) return askToEnd(endId)
    const filesId = attr('showFiles'), detailsId = attr('showDetails')
    const flip = (set, key) => { set.has(key) ? set.delete(key) : set.add(key); renderLive() }
    if (filesId) return flip(state.showFiles, filesId)
    const screenId = attr('showScreen')
    if (screenId) { flip(state.showScreen, screenId); if (state.showScreen.has(screenId)) refreshScreens().then(renderLive); return }
    const askId = attr('askAnswer')
    if (askId) return answerAsk(askId, target.closest('[data-ask-answer]').dataset.choice)
    const pick = target.closest('[data-ask-pick]')
    if (pick) return pickOption(pick)
    if (detailsId) return flip(state.showDetails, detailsId)
    const toggleId = attr('toggle')
    if (toggleId) {
      state.collapsed.has(toggleId) ? state.collapsed.delete(toggleId) : state.collapsed.add(toggleId)
      return renderLive()
    }
    if (focusId) return focusTab(focusId)
    const attachId = attr('attach')
    if (attachId) return attachHidden(attachId)
    const copyText = attr('copy')
    if (copyText) { navigator.clipboard?.writeText(copyText).then(() => toast(`Copied ${copyText}`), () => toast(copyText)); return }
    if (sendId) return sendFromDraft(sendId)
    const modelId = attr('applyModel'), renameId = attr('applyRename')
    if (modelId) { event.preventDefault(); return askToSwitchModel(modelId, fieldValue('model:' + modelId, sessionById(modelId)?.model || '')) }
    if (renameId) { event.preventDefault(); return sessionCommand(renameId, 'rename', fieldValue('rename:' + renameId, sessionById(renameId)?.name || '')) }
    if (selectId) {
      target.checked ? state.selected.add(selectId) : state.selected.delete(selectId)
      return renderLive()
    }
    if (messageId) {
      state.paneTab[messageId] = 'chat'
      selectSession(messageId)
      document.querySelector(`textarea[data-draft="${CSS.escape(messageId)}"]`)?.focus()
      return
    }
    const menuId = attr('actionsMenu')
    if (menuId) { state.actionsMenu = state.actionsMenu === menuId ? '' : menuId; return renderLive() }
    if (state.actionsMenu && !target.closest('.actions-menu')) { state.actionsMenu = ''; renderLive() }
    const paneTab = target.closest('[data-pane-tab]')
    if (paneTab) {
      const sessionId = paneTab.dataset.session, tab = paneTab.dataset.paneTab
      state.paneTab[sessionId] = tab
      state.showScreen = tab === 'screen' ? new Set([sessionId]) : new Set()
      renderLive()
      if (tab === 'screen') refreshScreens().then(renderLive)
      return
    }
    const filter = target.closest('[data-filter]')
    if (filter) { state.filter = filter.dataset.filter; return renderLive() }
    if (target.closest('[data-open-office]')) return setTab('office')
    if (target.closest('textarea, button, input, select, a, .session-pane')) return
    const row = target.closest('tr.session, .nav-item')
    if (!row) return
    selectSession(row.dataset.id)
  })
  $('#view-sessions').addEventListener('input', event => {
    const id = event.target.dataset && event.target.dataset.draft
    if (id) state.drafts[id] = event.target.value
    const field = event.target.dataset && event.target.dataset.field
    if (field) state.fields[field] = event.target.value
  })
  $('#view-sessions').addEventListener('change', event => {
    const field = event.target.dataset && event.target.dataset.field
    if (field) state.fields[field] = event.target.value
  })
  $('#view-sessions').addEventListener('keydown', event => {
    const id = event.target.dataset && event.target.dataset.draft
    if (id && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault()
      sendFromDraft(id)
    }
    const field = event.target.dataset && event.target.dataset.field
    if (field && field.startsWith('rename:') && event.key === 'Enter') {
      event.preventDefault()
      const sessionId = field.slice('rename:'.length)
      sessionCommand(sessionId, 'rename', event.target.value)
    }
  })
  for (const box of ['#live-search', '#nav-search']) $(box).addEventListener('input', event => {
    state.search = event.target.value
    for (const other of ['#live-search', '#nav-search']) if ($(other) !== event.target) $(other).value = state.search
    renderLive()
  })
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)))
  wideQuery.addEventListener('change', () => { placeTiles(); drawOfficeMini() })
  $('#select-all').addEventListener('change', event => {
    const sessions = state.live?.sessions || []
    state.selected = event.target.checked ? new Set(sessions.map(s => s.sessionId)) : new Set()
    renderLive()
  })
}
