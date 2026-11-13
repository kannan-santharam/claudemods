// What you sent from the page, shown the moment you send it and ticked like a
// chat app: no tick while it is on its way to Fleet, one tick once Fleet holds
// it, two once it has reached Claude. A message that did not arrive says why
// and can be sent again. Once the transcript carries the message, its own
// bubble takes over and keeps the two ticks. Held in this page's memory only.

import { api } from '../core/api.js'
import { escapeHtml, timeAgo } from '../core/format.js'
import { state } from '../core/state.js'

const KEPT_PER_SESSION = 30
// A prompt is written to the transcript just after it is sent; clocks differ a little.
const CLOCK_SLACK_MS = 10_000
const COMPARED_LENGTH = 160
// Set by initOutbox: draw the Sessions tab again, and fetch the live view again.
let rerender = () => {}
let refresh = () => {}
let nextLocalId = 1

export function initOutbox(renderLive, refreshLive) {
  rerender = renderLive
  refresh = refreshLive
}

const outboxOf = sessionId => (state.outbox[sessionId] ||= [])
const entryById = localId => Object.values(state.outbox).flat().find(entry => entry.localId === localId)
const sentence = text => (text ? text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.') : '')
const squeezed = text => String(text || '').replace(/\s+/g, ' ').trim()

function showNewest() {
  rerender()
  const body = document.querySelector('#session-pane .pane-body')
  if (body) body.scrollTop = body.scrollHeight
}

async function post(entry) {
  Object.assign(entry, { status: 'sending', reason: '', serverId: '', at: Date.now() })
  showNewest()
  try {
    const result = await api('/api/send', { sessionIds: [entry.sessionId], text: entry.text })
    if (result.queued) Object.assign(entry, { status: 'sent', serverId: result.ids[0] })
    else Object.assign(entry, { status: 'failed', reason: 'This session is no longer running.' })
  } catch (error) {
    Object.assign(entry, { status: 'failed', reason: error instanceof TypeError ? 'Could not reach Fleet. Check that it is still running.' : error.message })
  }
  rerender()
  for (const delay of [1200, 2500, 6000]) setTimeout(refresh, delay)
}

export function sendToSession(sessionId, text) {
  const list = outboxOf(sessionId)
  const entry = { localId: 'out-' + nextLocalId++, sessionId, text, at: Date.now(), status: 'sending', reason: '', serverId: '' }
  list.push(entry)
  if (list.length > KEPT_PER_SESSION) list.splice(0, list.length - KEPT_PER_SESSION)
  post(entry)
}

export function resend(localId) {
  const entry = entryById(localId)
  if (entry?.status === 'failed') post(entry)
}

export function discardSent(localId) {
  const entry = entryById(localId)
  if (!entry || entry.status !== 'failed') return
  const list = outboxOf(entry.sessionId)
  list.splice(list.indexOf(entry), 1)
  rerender()
}

// Each live view says what became of the messages Fleet was holding.
export function reconcileOutbox() {
  const deliveries = new Map((state.live?.deliveries || []).map(delivery => [delivery.id, delivery]))
  const running = new Set((state.live?.sessions || []).map(session => session.sessionId))
  for (const entry of Object.values(state.outbox).flat()) {
    if (entry.status !== 'sent') continue
    const delivery = deliveries.get(entry.serverId)
    if (delivery) Object.assign(entry, delivery.isDelivered ? { status: 'delivered' } : { status: 'failed', reason: delivery.reason || 'The session did not take it.' })
    else if (state.live && !running.has(entry.sessionId)) Object.assign(entry, { status: 'failed', reason: 'The session ended before the message reached it.' })
  }
}

const TICKS = {
  sending: '<span class="ticks sending" title="On its way to Fleet" aria-label="Sending">Sending…</span>',
  sent: '<span class="ticks" title="Sent. Fleet is holding it until Claude takes it." aria-label="Sent">✓</span>',
  delivered: '<span class="ticks reached" title="Reached Claude" aria-label="Reached Claude">✓✓</span>',
  failed: '<span class="ticks failed" aria-label="Not delivered">✕</span>',
}

// Pairs what was sent with the transcript's own messages, oldest first and each
// message once, so the same words sent twice are two messages. Returns the tick
// for a transcript message, and what the transcript does not carry yet.
export function matchOutbox(sessionId, messages) {
  const entries = state.outbox[sessionId] || []
  const taken = new Set()
  const tickOf = new Map()
  const waiting = []
  for (const entry of entries) {
    const wanted = squeezed(entry.text).slice(0, COMPARED_LENGTH)
    const match = entry.status === 'failed' || entry.status === 'sending' ? null : messages.find(message => message.from === 'you' && !taken.has(message) && (message.at || 0) >= entry.at - CLOCK_SLACK_MS && squeezed(message.text).includes(wanted))
    if (match) { taken.add(match); tickOf.set(match, TICKS.delivered) } else waiting.push(entry)
  }
  return { tickOf: message => tickOf.get(message) || '', waiting }
}

// A message that did not arrive is one card: its text, why it failed and its
// two buttons inside the same outline, so with several in a row each button
// plainly belongs to the message it sits in.
export function outgoingBubble(entry) {
  const id = escapeHtml(entry.localId)
  const text = `<div class="bubble"><span class="mine">${escapeHtml(entry.text)}</span></div>`
  if (entry.status !== 'failed') return `<div class="msg you outgoing ${entry.status}">${text}<div class="stamp">You · ${timeAgo(entry.at)} ago ${TICKS[entry.status]}</div></div>`
  return `<div class="msg you outgoing failed"><div class="failed-card" role="group" aria-label="Message not delivered">${text}
    <div class="send-failed" role="alert"><span class="why">${TICKS.failed} Not delivered. ${escapeHtml(sentence(entry.reason))}</span><span class="send-actions"><button type="button" class="send-link" data-resend="${id}">Resend</button><button type="button" class="send-link quiet" data-discard-sent="${id}">Discard</button></span></div>
  </div><div class="stamp">You · ${timeAgo(entry.at)} ago</div></div>`
}
