// Commands sent to a session: model and rename, open its tab or attach a hidden
// one, and messages.

import { api } from '../core/api.js'
import { toast } from '../core/dom.js'
import { state } from '../core/state.js'
import { refreshLive } from '../refresh.js'
import { renderLive } from './live.js'

export async function sessionCommand(sessionId, command, args) {
  if (!args) return toast(command === 'model' ? 'Choose a model first' : 'Give it a name first')
  try {
    const result = await api('/api/command', { sessionId, command, args })
    if (!result.ok) return toast(result.reason)
    toast(result.via === 'command' ? `Sent /${command} — it runs when the session is idle` : `Typed /${command} into its tab`)
    delete state.fields[`${command}:${sessionId}`]
    setTimeout(refreshLive, 2500)
  } catch (error) { toast(error.message) }
}
export async function loadOptions() {
  try { state.options = await api('/api/options') } catch {}
}
export async function attachHidden(sessionId) {
  try {
    const result = await api('/api/attach', { sessionId })
    toast(result.ok ? 'Opened in a terminal tab. Closing that tab leaves it running hidden.' : result.reason)
  } catch (error) { toast(error.message) }
}
export async function focusTab(sessionId) {
  try {
    const result = await api('/api/focus', { sessionId })
    toast(result.ok ? 'Brought its terminal tab to the front' : result.reason)
  } catch (error) { toast(error.message) }
}
async function sendMessage(sessionIds, text) {
  if (!text.trim() || !sessionIds.length) return false
  try {
    const result = await api('/api/send', { sessionIds, text })
    toast(`Queued for ${result.queued} session${result.queued === 1 ? '' : 's'} — delivered within a few seconds`)
    setTimeout(refreshLive, 2500)
    setTimeout(refreshLive, 6000)
    return true
  } catch (error) { toast(error.message); return false }
}
export async function sendFromDraft(sessionId) {
  if (await sendMessage([sessionId], state.drafts[sessionId] || '')) { state.drafts[sessionId] = ''; renderLive() }
}
