// Stop from the dashboard: while this session's own turn runs, one request is
// held open at the dashboard server, which answers it the moment the page asks
// for a stop. The turn is then cancelled here, as Escape does in the terminal.
// A stop asked just before the turn began (a message sent from the page and
// stopped at once) is waiting at the server and answers the first request.
//
// Nothing is held open between turns: the request is let go as the turn ends,
// so a session that has finished (a headless run) never waits on it to exit.

import type { EngineInterface, Hook } from 'claude-code'

import { isThisSessionExcluded } from './excluded'
import { callServer } from './server'

// How long to leave a dashboard that is not answering before asking again.
const RETRY_MS = 1000
// The least time between two requests, whatever came back: a dashboard that
// answers at once must never be asked in a tight loop.
const PAUSE_MS = 250

// The main loop's running turn, by the id its turn.start carried.
let runningTurn = ''

// Whether the turn was cancelled. At a turn's very start the engine may not
// count it as running yet, so a refusal is tried again a few times.
async function cancel($: EngineInterface, turnId: string): Promise<boolean> {
  for (let attempt = 0; attempt < 5 && runningTurn === turnId; attempt++) {
    try {
      await $.turn.abort({ turnId })
      return true
    } catch {
      await $.clock.sleep(200)
    }
  }
  return false
}

async function listenForStop($: EngineInterface, turnId: string): Promise<void> {
  try {
    if (await isThisSessionExcluded($)) return
    const sessionId = await $.session.id()
    while (runningTurn === turnId) {
      const answer = await callServer($, `/api/stop/wait?sessionId=${encodeURIComponent(sessionId)}`).catch(() => undefined)
      if (runningTurn !== turnId) return
      // A cancel that did not land leaves the turn running: keep listening.
      if (answer?.stop === true && (await cancel($, turnId))) return
      await $.clock.sleep(answer ? PAUSE_MS : RETRY_MS)
    }
  } catch {
    // The turn ended first, or the dashboard went away: nothing to stop.
  }
}

// The turn is over: the held request comes back now rather than when its wait is over.
function letGo($: EngineInterface, turnId: string): void {
  if (runningTurn !== turnId) return
  runningTurn = ''
  void (async () => callServer($, '/api/stop/release', { sessionId: await $.session.id() }))().catch(() => undefined)
}

// Both observe only: the turn starts and ends as it would without Fleet.
export const watchTurnStart: Hook<'turn.start'> = ($, event, next) => {
  if (event.agentId !== undefined) return next(event)
  runningTurn = event.turnId
  void listenForStop($, event.turnId)
  const started = next(event)
  // A turn that never started has no end to wait for.
  void Promise.resolve(started).catch(() => letGo($, event.turnId))
  return started
}

export const watchTurnEnd: Hook<'turn.complete'> = ($, event, next) => {
  if (event.agentId === undefined) letGo($, event.turnId)
  return next(event)
}
