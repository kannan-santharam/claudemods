// What the page reads: the live view, reports, recently closed sessions, a
// session's conversation (or one of its subagents'), its subagents, a hidden
// session's screen, and the open connection that says when a conversation changed.

import { REPORT_RANGES } from '../constants.mjs'
import { readConversation } from '../conversation.mjs'
import { send } from '../http.mjs'
import { listSubagents, liveView } from '../live-view.mjs'
import { openEvents } from '../push.mjs'
import { hasToken } from '../security.mjs'
import { listRecentlyClosed } from '../recently-closed.mjs'
import { buildReport } from '../reports.mjs'
import { hiddenScreen } from '../screen.mjs'

export const getRoutes = {
  '/api/live': ({ response }) => send(response, 200, liveView()),
  '/api/report': ({ response, url }) => {
    const range = url.searchParams.get('range')
    return send(response, 200, buildReport(Object.hasOwn(REPORT_RANGES, range) ? range : 'today'))
  },
  '/api/recently-closed': ({ response }) => send(response, 200, { sessions: listRecentlyClosed() }),
  '/api/conversation': async ({ response, url }) => {
    const { searchParams } = url
    return send(response, 200, await readConversation(searchParams.get('sessionId') || '', searchParams.get('before'), searchParams.get('limit'), searchParams.get('agentId') || ''))
  },
  '/api/subagents': async ({ response, url }) => send(response, 200, { subagents: await listSubagents(url.searchParams.get('sessionId') || '') }),
  // Kept open: push.mjs writes to it until the page lets go.
  // A page elsewhere on this machine shares the cookie (same site, another
  // port) but not the origin: it may not hold connections open here.
  '/api/events': ({ request, response, url }) => {
    if (!hasToken(request) && request.headers['sec-fetch-site'] !== 'same-origin') return send(response, 403, { error: 'for the dashboard page' })
    const opened = openEvents(request, response, url.searchParams.get('sessionId') || '', url.searchParams.get('agentId') || '')
    if (opened === 'bad') send(response, 400, { error: 'sessionId' })
    if (opened === 'full') send(response, 503, { error: 'too many open conversations' })
  },
  '/api/screen': async ({ response, url }) => send(response, 200, await hiddenScreen(url.searchParams.get('sessionId') || '')),
}
