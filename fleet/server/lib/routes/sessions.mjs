import { isExcludedPath } from '../config.mjs'
import { endSession } from '../end-sessions.mjs'
import { browse } from '../folder-browser.mjs'
import { attachHidden } from '../hidden-sessions.mjs'
import { send } from '../http.mjs'
import { MODELS, listFolders, startSession } from '../new-sessions.mjs'
import { listHistory, resumeSession } from '../resume.mjs'
import { runSessionCommand } from '../session-commands.mjs'
import { heartbeats, settings } from '../state.mjs'
import { focusTab } from '../terminal.mjs'

export const getRoutes = {
  '/api/browse': async ({ response, url }) => {
    return send(response, 200, await browse(url.searchParams.get('path') || ''))
  },
  '/api/history': async ({ response, url }) => {
    return send(response, 200, await listHistory(url.searchParams.get('folder') || ''))
  },
  '/api/options': async ({ response }) => {
    return send(response, 200, { root: settings.newSessionRoot, folders: await listFolders(), models: MODELS })
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
      rateLimits: Array.isArray(body.rateLimits) ? body.rateLimits.slice(0, 5) : [],
    })
    return send(response, 200, { ok: true })
  },
  '/api/focus': async ({ response, body }) => send(response, 200, await focusTab(String(body.sessionId || ''))),
  '/api/sessions': async ({ response, body }) => send(response, 200, await startSession(body)),
  '/api/command': async ({ response, body }) => send(response, 200, await runSessionCommand(body)),
  '/api/resume': async ({ response, body }) => send(response, 200, await resumeSession(body)),
  '/api/end': async ({ response, body }) => send(response, 200, await endSession(body)),
  '/api/attach': async ({ response, body }) => send(response, 200, await attachHidden(String(body.sessionId || ''))),
}
