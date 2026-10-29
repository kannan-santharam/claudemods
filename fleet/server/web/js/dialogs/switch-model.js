// The Switch model dialog.

import { $, toast } from '../core/dom.js'
import { formatTokens, shortModel } from '../core/format.js'
import { sessionById, state } from '../core/state.js'
import { sessionCommand } from '../sessions/actions.js'

// The session would ask "Switch model?" in its terminal; it is asked here
// instead, and the session is told the answer, so nothing waits in the tab.
const switching = { sessionId: '', model: '' }
export function askToSwitchModel(sessionId, model) {
  const session = sessionById(sessionId)
  if (!session) return
  if (!model) return toast('Choose a model first')
  if (model === session.model) return toast(`${session.name} already uses ${shortModel(model)}`)
  Object.assign(switching, { sessionId, model })
  const label = (state.options?.models || []).find(option => option.id === model)?.label || shortModel(model)
  $('#model-title').textContent = `Switch ${session.name} to ${label}?`
  $('#model-text').textContent = session.contextTokens
    ? `Its conversation is cached for ${shortModel(session.model)}. On ${label}, the full history (${formatTokens(session.contextTokens)} tokens) is read again with its next message, so that reply is slower and uses more tokens. Later replies are cached again.`
    : `It switches to ${label} for its next message.`
  $('#model-confirm').textContent = `Switch to ${label}`
  $('#model-dialog').hidden = false
  $('#model-confirm').focus()
}
function closeModelDialog() { $('#model-dialog').hidden = true }

export function initSwitchModelDialog() {
  $('#model-cancel').addEventListener('click', closeModelDialog)
  $('#model-dialog').addEventListener('click', event => { if (event.target.id === 'model-dialog') closeModelDialog() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#model-dialog').hidden) closeModelDialog() })
  $('#model-form').addEventListener('submit', async event => {
    event.preventDefault()
    closeModelDialog()
    await sessionCommand(switching.sessionId, 'model', switching.model)
  })
}
