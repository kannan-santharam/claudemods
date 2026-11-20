// The open conversation's line to the server: one connection, kept open, over
// which the server says at once that the transcript has new lines, and sends
// the reply a connected session is writing as it grows. The 2-second refresh
// carries on underneath, so a connection that drops only makes the chat slower.

import { state } from '../core/state.js'
import { reloadConversation } from './conversation.js'

// Set by initPush: draws the Sessions tab again, unless a select is open in it.
let rerender = () => {}
let source = null
let watchedKey = ''
let isDrawWanted = false

// One redraw per frame, however fast the pieces arrive.
function draw() {
  if (isDrawWanted) return
  isDrawWanted = true
  requestAnimationFrame(() => {
    isDrawWanted = false
    rerender()
  })
}

// The conversation the pane shows ('' for none). A conversation's key is its
// session's id, or `<session id>:<agent id>` for a subagent's.
let wantedKey = ''

// A browser allows a handful of connections to one server across all its tabs
// and windows, and each of these is held open for good: with one per tab, six
// dashboard tabs would leave none for anything else. So at most two tabs hold
// one at a time, by a lock the browser shares between them, and only while in
// view; the others stay on the 2-second refresh and take a place when one is
// let go. A browser without such locks holds its one connection as it is.
const PLACES = ['fleet-live-1', 'fleet-live-2']
let letGoOfPlace = null
let isAskingForPlace = false
async function takePlace() {
  if (letGoOfPlace || !navigator.locks) return true
  if (isAskingForPlace) return false
  isAskingForPlace = true
  try {
    for (const place of PLACES) {
      const isTaken = await new Promise(resolve => {
        navigator.locks
          .request(place, { ifAvailable: true }, lock => {
            if (!lock) return resolve(false)
            // Held until let go, or until this tab closes.
            return new Promise(free => {
              letGoOfPlace = free
              resolve(true)
            })
          })
          .catch(() => resolve(false))
      })
      if (isTaken) return true
    }
    return false
  } finally {
    isAskingForPlace = false
  }
}
function leavePlace() {
  letGoOfPlace?.()
  letGoOfPlace = null
}

const keyInView = () => (document.hidden ? '' : wantedKey)
// The connection follows the pane. Called on every redraw, so a tab that found
// no place free asks again by itself.
async function follow() {
  if (keyInView() === watchedKey) return
  source?.close()
  source = null
  watchedKey = ''
  if (!keyInView() || typeof EventSource !== 'function') return leavePlace()
  if (!(await takePlace())) return
  // The pane may have moved on, or another call got here first, while that was asked.
  const key = keyInView()
  if (!key) return leavePlace()
  if (source) return
  watchedKey = key
  const [sessionId, agentId = ''] = key.split(':')
  // Signed in by the same cookie as every other read. A refused connection is
  // not retried; one the network dropped reconnects by itself.
  const opened = new EventSource(`/api/events?sessionId=${encodeURIComponent(sessionId)}${agentId ? '&agentId=' + encodeURIComponent(agentId) : ''}`)
  source = opened
  opened.addEventListener('changed', () => {
    if (source === opened) reloadConversation(key)
  })
  opened.addEventListener('stream', event => {
    if (source !== opened) return
    try {
      const stream = JSON.parse(event.data)
      const receivedAt = Date.now() - (Number(stream.ageMs) || 0)
      state.streams[sessionId] = { id: String(stream.id || ''), text: String(stream.text || ''), isDone: stream.isDone === true, startedAt: Number(stream.startedAt) || receivedAt, receivedAt }
    } catch {
      return
    }
    draw()
  })
}

// Called with the pane's conversation each time it is drawn.
export function watchConversation(key) {
  wantedKey = key
  void follow()
}

export function initPush(renderLive) {
  rerender = renderLive
  document.addEventListener('visibilitychange', () => {
    void follow()
    // Back in view: what arrived meanwhile is read at once.
    if (!document.hidden && wantedKey) reloadConversation(wantedKey)
  })
}
