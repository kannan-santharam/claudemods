import { answerAsk, cancelAsk, createAsk, waitForAnswer } from '../asks.mjs'
import { send } from '../http.mjs'
import { shellsOf } from '../live-view.mjs'
import { scanRegistry } from '../registry.mjs'
import { hasToken } from '../security.mjs'
import { fileIndexes, live, transcriptScan } from '../state.mjs'

export const getRoutes = {
  '/api/asks/mode': async ({ response, url }) => {
    // A session asks right after it starts, often before the 2-second registry scan has
    // seen it: look again before answering, or its question would go to a terminal nobody sees.
    const askedFor = url.searchParams.get('sessionId') || ''
    if (!live.has(askedFor)) await scanRegistry()
    const session = live.get(askedFor)
    if (session?.hidden && fileIndexes.mainFileIndex.version !== transcriptScan.filesVersion) shellsOf(session, Date.now())
    return send(response, 200, { hidden: Boolean(session?.hidden), permissionMode: (session && fileIndexes.mainFileIndex.bySession.get(session.sessionId)?.permissionMode) || '' })
  },
  '/api/asks/wait': async ({ request, response, url }) => {
    if (!hasToken(request)) return send(response, 401, { error: 'only a session waits for answers' })
    return send(response, 200, await waitForAnswer(url.searchParams.get('id') || ''))
  },
}

export const postRoutes = {
  '/api/asks': ({ request, response, body }) => {
    if (!hasToken(request)) return send(response, 401, { error: 'only a session asks' })
    return send(response, 200, createAsk(body))
  },
  '/api/asks/cancel': ({ request, response, body }) => {
    if (!hasToken(request)) return send(response, 401, { error: 'only a session cancels its question' })
    return send(response, 200, cancelAsk(body))
  },
  '/api/asks/answer': ({ response, body }) => send(response, 200, answerAsk(body)),
}
