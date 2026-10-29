// Messages from the page to sessions: queued here, collected by each session's
// mod from its inbox and acknowledged once delivered.

import crypto from 'node:crypto'
import { send } from '../http.mjs'
import { acknowledge, claimFor } from '../messaging.mjs'
import { live, messaging } from '../state.mjs'
import { stripControls } from '../typing.mjs'

export const getRoutes = {
  '/api/inbox': ({ response, url }) => {
    const sessionId = url.searchParams.get('sessionId') || ''
    return send(response, 200, { messages: claimFor(sessionId) })
  },
}

export const postRoutes = {
  '/api/send': ({ response, body }) => {
    const text = stripControls(String(body.text || '')).trim()
    const targets = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : []
    if (!text || !targets.length) return send(response, 400, { error: 'text and sessionIds are required' })
    if (text.length > 20000) return send(response, 400, { error: 'message too long' })
    const queued = targets
      .filter(sessionId => live.has(sessionId))
      .map(sessionId => {
        const item = { id: crypto.randomUUID(), sessionId, text, createdAt: Date.now(), claimedAt: 0, claimedBy: '' }
        messaging.inbox.push(item)
        return item.id
      })
    return send(response, 200, { queued: queued.length, ids: queued })
  },
  '/api/inbox/ack': ({ response, body }) => {
    acknowledge(String(body.id || ''), body)
    return send(response, 200, { ok: true })
  },
}
