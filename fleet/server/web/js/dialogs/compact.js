import { api } from '../core/api.js'
import { $, toast } from '../core/dom.js'
import { fmtTokens } from '../core/format.js'
import { sessionById } from '../core/state.js'
import { refreshLive } from '../refresh.js'

// ------------------------------------------------------------- compacting --
// /compact summarises the conversation so far and keeps going from the summary.
let compactingId = ''
export function askToCompact(sessionId) {
  const session = sessionById(sessionId)
  if (!session) return
  compactingId = sessionId
  $('#compact-title').textContent = `Compact ${session.name}?`
  $('#compact-text').textContent = `Its context is ${session.contextPercent}% full (${fmtTokens(session.contextTokens)} of ${fmtTokens(session.contextWindow)}). Compacting replaces the conversation so far with a summary, so it can keep working with room to spare. ` +
    (session.status === 'busy' ? 'It is working now, so it compacts as soon as it is idle.' : session.hasMod ? 'It runs right away.' : 'It is typed into its tab while it is idle.')
  $('#compact-focus').value = ''
  $('#compact-dialog').hidden = false
  $('#compact-focus').focus()
}
function closeCompactDialog() { $('#compact-dialog').hidden = true }

export function initCompactDialog() {
  $('#compact-cancel').addEventListener('click', closeCompactDialog)
  $('#compact-dialog').addEventListener('click', event => { if (event.target.id === 'compact-dialog') closeCompactDialog() })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#compact-dialog').hidden) closeCompactDialog() })
  $('#compact-form').addEventListener('submit', async event => {
    event.preventDefault()
    const sessionId = compactingId
    const button = $('#compact-confirm')
    button.disabled = true
    try {
      const result = await api('/api/command', { sessionId, command: 'compact', args: $('#compact-focus').value.trim() })
      closeCompactDialog()
      toast(result.ok ? `${sessionById(sessionId)?.name || 'The session'} will compact ${result.via === 'command' ? 'when idle' : 'once its tab is idle'}` : result.reason)
      setTimeout(refreshLive, 3000)
    } catch (error) { toast(error.message) } finally { button.disabled = false }
  })
}
