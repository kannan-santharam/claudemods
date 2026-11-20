// Commands sent to a session: model and rename, open its tab or attach a hidden
// one, and messages.

import { api } from '../core/api.js'
import { toast } from '../core/dom.js'
import { state } from '../core/state.js'
import { refreshLive } from '../refresh.js'
import { canStop, sendToSession } from './outbox.js'

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
// Stop what a session is doing, as Escape does in its terminal: its mod
// cancels the running turn, or the one a message just sent is about to start.
const stopping = new Set()
const STOP_AGAIN_MS = 800
export async function stopSession(sessionId) {
  const session = state.live?.sessions.find(found => found.sessionId === sessionId)
  // One stop at a time: a second press while the first is on its way adds nothing.
  if (!session || !canStop(session) || stopping.has(sessionId)) return
  stopping.add(sessionId)
  try {
    const result = await api('/api/stop', { sessionId })
    toast(result.ok ? `Stopping ${session.name}` : result.reason)
    if (result.ok) for (const delay of [400, 1500]) setTimeout(refreshLive, delay)
  } catch (error) {
    toast(error.message)
  } finally {
    setTimeout(() => stopping.delete(sessionId), STOP_AGAIN_MS)
  }
}
// The message shows in the chat at once; outbox.js follows it from there.
export function sendFromDraft(sessionId) {
  const text = (state.drafts[sessionId] || '').trim()
  if (!text) return
  state.drafts[sessionId] = ''
  sendToSession(sessionId, text)
}
