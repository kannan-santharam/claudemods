// What the page reads: the live view, reports, recently closed sessions, a
// session's conversation and a hidden session's screen.

import { readConversation } from '../conversation.mjs'
import { send } from '../http.mjs'
import { liveView } from '../live-view.mjs'
import { listRecentlyClosed } from '../recently-closed.mjs'
import { buildReport } from '../reports.mjs'
import { hiddenScreen } from '../screen.mjs'

export const getRoutes = {
  '/api/live': ({ response }) => send(response, 200, liveView()),
  '/api/report': ({ response, url }) => {
    return send(response, 200, buildReport(url.searchParams.get('range') === 'today' ? 'today' : '7d'))
  },
  '/api/recently-closed': ({ response }) => send(response, 200, { sessions: listRecentlyClosed() }),
  '/api/conversation': async ({ response, url }) => {
    const { searchParams } = url
    return send(response, 200, await readConversation(searchParams.get('sessionId') || '', searchParams.get('before'), searchParams.get('limit')))
  },
  '/api/screen': async ({ response, url }) => send(response, 200, await hiddenScreen(url.searchParams.get('sessionId') || '')),
}
