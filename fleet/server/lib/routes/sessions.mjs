// Session actions and the pickers behind them: heartbeats from the mods, focus,
// start, resume, end, attach, /model /rename /compact, folders and history.

import { isExcludedPath } from '../config.mjs'
import { noteToolStart } from '../conversation.mjs'
import { endSession } from '../end-sessions.mjs'
import { browse } from '../folder-browser.mjs'
import { attachHidden } from '../hidden-sessions.mjs'
import { send } from '../http.mjs'
import { noteStream } from '../push.mjs'
import { hasToken } from '../security.mjs'
import { isSessionId, releaseStop, requestStop, waitForStop } from '../stops.mjs'
import { liveView } from '../live-view.mjs'
import { listFolders, offeredModels, startSession } from '../new-sessions.mjs'
import { listHistory, resumeSession } from '../resume.mjs'
import { runSessionCommand } from '../session-commands.mjs'
import { heartbeats, settings } from '../state.mjs'
import { focusTab } from '../terminal.mjs'

export const getRoutes = {
  // Held open by a session's mod: answered when the page asks for a stop. Only
  // a mod asks, so only the token opens it, never the browser's cookie.
  '/api/stop/wait': async ({ request, response, url }) => {
    const sessionId = url.searchParams.get('sessionId') || ''
    if (!hasToken(request)) return send(response, 403, { error: 'for a session, not a page' })
    if (!isSessionId(sessionId)) return send(response, 400, { error: 'sessionId' })
    const answer = await waitForStop(request, sessionId)
    // The mod let go first: there is nobody to answer.
    if (answer) send(response, 200, answer)
  },
  '/api/browse': async ({ response, url }) => {
    return send(response, 200, await browse(url.searchParams.get('path') || ''))
  },
  '/api/history': async ({ response, url }) => {
    return send(response, 200, await listHistory(url.searchParams.get('folder') || ''))
  },
  '/api/options': async ({ response }) => {
    const inUse = liveView().sessions.map(session => session.model)
    return send(response, 200, { root: settings.newSessionRoot, folders: await listFolders(), models: offeredModels(inUse) })
  },
}

export const postRoutes = {
  '/api/heartbeat': ({ response, body }) => {
    if (typeof body.sessionId !== 'string') return send(response, 400, { error: 'sessionId' })
    if (isExcludedPath(String(body.cwd || ''))) return send(response, 200, { ok: true, excluded: true })
    heartbeats.set(body.sessionId, {
      at: Date.now(),
      model: String(body.model || ''),
      context: body.context || null,
      costUsd: typeof body.costUsd === 'number' ? body.costUsd : null,
      turns: typeof body.turns === 'number' ? body.turns : null,
      rateLimits: Array.isArray(body.rateLimits) ? body.rateLimits.filter(limit => limit && typeof limit === 'object' && typeof limit.kind === 'string').slice(0, 5) : [],
      canStop: body.canStop === true,
    })
    return send(response, 200, { ok: true })
  },
  // Stop what a session is doing, as Escape does in its terminal.
  '/api/stop': ({ response, body }) => send(response, 200, requestStop(body.sessionId)),
  // Its turn has ended: the request it held open comes back now.
  '/api/stop/release': ({ response, body }) => {
    releaseStop(body.sessionId)
    return send(response, 200, { ok: true })
  },
  // The reply a session's mod sees being written, for its chat to show as it grows.
  '/api/stream': ({ response, body }) => {
    const { sessionId, id, text } = body
    if (typeof sessionId !== 'string' || typeof id !== 'string' || !noteStream(sessionId, id.slice(0, 120), typeof text === 'string' ? text : '', body.isDone === true)) return send(response, 400, { error: 'sessionId and id' })
    return send(response, 200, { ok: true })
  },
  // The tool a session's mod has just started, for the sentence its chat shows.
  '/api/activity': ({ response, body }) => {
    if (typeof body.sessionId !== 'string' || typeof body.tool !== 'string') return send(response, 400, { error: 'sessionId' })
    noteToolStart(body.sessionId, body.tool.slice(0, 100), body.input)
    return send(response, 200, { ok: true })
  },
  '/api/focus': async ({ response, body }) => send(response, 200, await focusTab(String(body.sessionId || ''))),
  '/api/sessions': async ({ response, body }) => send(response, 200, await startSession(body)),
  '/api/command': async ({ response, body }) => send(response, 200, await runSessionCommand(body)),
  '/api/resume': async ({ response, body }) => send(response, 200, await resumeSession(body)),
  '/api/end': async ({ response, body }) => send(response, 200, await endSession(body)),
  '/api/attach': async ({ response, body }) => send(response, 200, await attachHidden(String(body.sessionId || ''))),
}
