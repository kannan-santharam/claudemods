// Stopping what a session is doing, from the page: the same as Escape in its
// terminal. While a connected session's turn runs, its mod holds a request open
// here (a long poll); the page's stop answers that request, and the mod cancels
// the turn. A message still waiting here for the session is withdrawn instead,
// and a stop for a message the session has just taken waits for its turn to
// begin. A session without the mod cannot be reached.
//
// A stop only ever falls on the turn it was asked for: one that nothing was
// there to take is kept briefly, and dropped when that turn ends.

import { acknowledge } from './messaging.mjs'
import { hasMod } from './registry.mjs'
import { deliveries, heartbeats, live, liveCache, messaging } from './state.mjs'

const waiters = new Map() // sessionId -> Set of done(answer)
const asked = new Map() // sessionId -> { at, keepMs }: a stop no request was open to take
// Per session: when its mod last opened a request, when its turn last ended,
// and when a stop was last passed on or kept for it.
const marks = new Map() // sessionId -> { waitAt, endAt, stopAt }
const WAIT_MS = 25_000
// A stop asked between two requests of a running turn reaches the next one.
const BETWEEN_POLLS_MS = 3000
// A message the session took this recently may not have started its turn yet:
// a stop asked meanwhile is kept for that turn's first request.
const JUST_TAKEN_MS = 10_000
export const isSessionId = text => typeof text === 'string' && /^[\w-]{1,100}$/.test(text)

function marksOf(sessionId) {
  for (const id of [...marks.keys()]) if (!live.has(id)) marks.delete(id)
  if (!marks.has(sessionId)) marks.set(sessionId, { waitAt: 0, endAt: 0, stopAt: 0 })
  return marks.get(sessionId)
}

// The mod's long poll: answers { stop: true } the moment the page asks, or
// { stop: false } when the wait is over or the turn has ended. A request the
// mod let go of stops waiting (null), so a stop is never answered into nothing.
export function waitForStop(request, sessionId) {
  marksOf(sessionId).waitAt = Date.now()
  const pending = asked.get(sessionId)
  asked.delete(sessionId)
  if (pending && Date.now() - pending.at < pending.keepMs) return Promise.resolve({ stop: true })
  return new Promise(resolve => {
    const waiting = waiters.get(sessionId) || new Set()
    waiters.set(sessionId, waiting)
    const done = answer => {
      clearTimeout(timer)
      request.off('close', gone)
      waiting.delete(done)
      if (!waiting.size) waiters.delete(sessionId)
      resolve(answer)
    }
    const gone = () => done(null)
    const timer = setTimeout(() => done({ stop: false }), WAIT_MS)
    request.on('close', gone)
    waiting.add(done)
  })
}

// The session's turn has ended: its held request comes back at once, and a
// stop that was kept for that turn is dropped with it.
export function releaseStop(sessionId) {
  if (!isSessionId(sessionId)) return
  for (const done of [...(waiters.get(sessionId) || [])]) done({ stop: false })
  asked.delete(sessionId)
  marksOf(sessionId).endAt = Date.now()
}

export function requestStop(sessionId) {
  const session = isSessionId(sessionId) ? live.get(sessionId) : null
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  const now = Date.now()
  const mark = marksOf(sessionId)
  liveCache.at = 0
  for (const [id, pending] of asked) if (now - pending.at > pending.keepMs) asked.delete(id)
  // What the page sent and the session has not collected yet never starts.
  const withdrawn = messaging.inbox.filter(item => item.sessionId === sessionId && !item.claimedAt)
  for (const item of withdrawn) acknowledge(item.id, { isDelivered: false, reason: 'Stopped before it was sent.', mode: 'prompt' })
  const refused = reason => (withdrawn.length ? { ok: true } : { ok: false, reason })
  // A request held open right now is a turn running right now.
  const waiting = waiters.get(sessionId)
  if (waiting?.size) {
    for (const done of [...waiting]) done({ stop: true })
    mark.stopAt = now
    return { ok: true }
  }
  // Otherwise only a turn that is about to run, or runs between two of its
  // requests, is stopped. A message counts as about to run until its turn has
  // been stopped or has ended; the registry's "busy" lags a turn's end by a
  // couple of seconds, so a turn that ended after its last request is over.
  const hasJustTaken = deliveries.some(delivery => delivery.sessionId === sessionId && delivery.isDelivered && delivery.via === 'prompt' && now - delivery.at < JUST_TAKEN_MS && delivery.at > Math.max(mark.stopAt, mark.endAt))
  const isBusy = session.status === 'busy'
  if (!isBusy && !hasJustTaken) return refused('Nothing is running there to stop.')
  if (!hasMod(sessionId)) return refused('Not connected, so Fleet cannot stop it from here.')
  if (!heartbeats.get(sessionId)?.canStop) return refused('This session still runs an older Fleet mod. It can be stopped from here after its next reply.')
  if (!hasJustTaken && mark.endAt >= mark.waitAt) return refused(mark.endAt ? 'It has just finished.' : 'It is not listening for a stop yet. Try again in a moment.')
  asked.set(sessionId, { at: now, keepMs: hasJustTaken ? JUST_TAKEN_MS : BETWEEN_POLLS_MS })
  mark.stopAt = now
  return { ok: true }
}
