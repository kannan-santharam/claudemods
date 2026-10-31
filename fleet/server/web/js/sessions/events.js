// Clicks, typing and changes inside the Sessions tab, handled by delegation on
// the tab, so the 2-second redraw never loses a listener.

import { $, toast } from '../core/dom.js'
import { fieldValue, sessionById, state } from '../core/state.js'
import { remember } from '../core/storage.js'
import { askToCompact } from '../dialogs/compact.js'
import { askToEnd } from '../dialogs/end-session.js'
import { askToSwitchModel } from '../dialogs/switch-model.js'
import { attachHidden, focusTab, sendFromDraft, sessionCommand } from './actions.js'
import { answerAsk, pickOption } from './asks.js'
import { drawOfficeMini, placeTiles, wideQuery } from './layout.js'
import { renderLive, selectSession } from './live.js'
import { refreshScreens } from './screen.js'
import { setTab } from '../tabs.js'

// List or Table, remembered in this browser. It sits beside the toggle's click,
// its only caller, rather than in layout.js, because it redraws the sessions
// and live.js already depends on layout.js.
function setView(view) {
  state.view = view === 'table' ? 'table' : 'list'
  remember('fleet-sessions-view', state.view)
  $('#view-sessions').dataset.layout = state.view
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)))
  placeTiles()
  renderLive()
  drawOfficeMini()
}

export function initSessionEvents() {
  // A click anywhere outside the actions menu closes it.
  document.addEventListener('click', event => {
    if (state.actionsMenu && !event.target.closest('.actions-menu')) { state.actionsMenu = ''; renderLive() }
  })
  $('#view-sessions').addEventListener('click', event => {
    const target = event.target
    // dataset keys are camelCase; their attributes are kebab-case (applyModel → data-apply-model).
    const dataAttribute = name => target.closest(`[data-${name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())}]`)?.dataset[name]
    const focusId = dataAttribute('focus'), sendId = dataAttribute('send'), selectId = dataAttribute('select')
    const compactId = dataAttribute('compact')
    if (compactId) return askToCompact(compactId)
    const endId = dataAttribute('end')
    if (endId) return askToEnd(endId)
    const askId = dataAttribute('askAnswer')
    if (askId) return answerAsk(askId, target.closest('[data-ask-answer]').dataset.choice)
    const pick = target.closest('[data-ask-pick]')
    if (pick) return pickOption(pick)
    const toggleId = dataAttribute('toggle')
    if (toggleId) {
      state.collapsed.has(toggleId) ? state.collapsed.delete(toggleId) : state.collapsed.add(toggleId)
      return renderLive()
    }
    if (focusId) return focusTab(focusId)
    const attachId = dataAttribute('attach')
    if (attachId) return attachHidden(attachId)
    // Code in a reply: the block's Copy button, or a click on inline code. Read
    // from the page, so the text is exactly what is shown.
    const codeCopy = target.closest('[data-copy-code]')
    const inlineCode = codeCopy ? null : target.closest('code[data-copy-inline]')
    if (codeCopy || inlineCode) {
      const code = codeCopy ? codeCopy.parentElement.querySelector('pre').textContent : inlineCode.textContent
      navigator.clipboard?.writeText(code).then(() => {
        if (codeCopy) codeCopy.textContent = 'Copied ✓'
        toast(codeCopy ? 'Copied the code' : `Copied ${code.length > 60 ? code.slice(0, 60) + '…' : code}`)
      }, () => toast('Could not copy: select it and press ⌘C'))
      return
    }
    const copyText = dataAttribute('copy')
    if (copyText) { navigator.clipboard?.writeText(copyText).then(() => toast(`Copied ${copyText}`), () => toast(copyText)); return }
    if (sendId) return sendFromDraft(sendId)
    const modelId = dataAttribute('applyModel'), renameId = dataAttribute('applyRename')
    if (modelId) { event.preventDefault(); return askToSwitchModel(modelId, fieldValue('model:' + modelId, sessionById(modelId)?.model || '')) }
    if (renameId) { event.preventDefault(); return sessionCommand(renameId, 'rename', fieldValue('rename:' + renameId, sessionById(renameId)?.name || '')) }
    if (selectId) {
      target.checked ? state.selected.add(selectId) : state.selected.delete(selectId)
      return renderLive()
    }
    const menuId = dataAttribute('actionsMenu')
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
    state.selected = event.target.checked ? new Set(sessions.map(session => session.sessionId)) : new Set()
    renderLive()
  })
}
