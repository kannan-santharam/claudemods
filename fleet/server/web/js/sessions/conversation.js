// A session's conversation in its pane, read from its transcript on demand: the
// newest ten turns first, older ones as the chat is scrolled up, and while it
// works, a sentence on what it is doing. What has been shown is held in this
// page's memory only; nothing is saved anywhere.

import { api } from '../core/api.js'
import { escapeHtml, markdown, timeAgo } from '../core/format.js'
import { state } from '../core/state.js'

const PAGE_SIZE = 10
// Scrolled this close to the top, the chat fetches the page before.
const LOAD_EDGE_PX = 120
// What a working session is doing is read again this often while it is shown.
const ACTIVITY_EVERY_MS = 2000
// Set by initConversation: draws the Sessions tab again once a page arrives.
let rerender = () => {}

function conversationOf(sessionId) {
  state.conversations[sessionId] ||= { messages: [], before: 0, hasMore: false, isLoaded: false, isLoading: false, hasFailed: false, seenAt: 0 }
  return state.conversations[sessionId]
}
const latestActivity = session => Math.max(session.lastPromptAt || 0, session.lastReplyAt || 0)

// One bubble: your prompt on the right, Claude's reply on the left. `key` tells
// each reply apart, so its own scroll survives the 2-second refresh.
export function messageBubble(message, key) {
  const stamp = message.at ? ' · ' + timeAgo(message.at) + ' ago' : ''
  return message.from === 'you'
    ? `<div class="msg you"><div class="bubble">${escapeHtml(message.text)}</div><div class="stamp">You${stamp}</div></div>`
    : `<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div><div class="bubble md" data-reply="${escapeHtml(key)}">${markdown(message.text)}</div><div class="stamp">Claude${stamp}</div></div></div>`
}

// The newest page, laid over what is shown: turns from its first one on are
// replaced, so a reply still being written grows in place.
async function loadNewest(session) {
  const conversation = conversationOf(session.sessionId)
  conversation.isLoading = true
  conversation.seenAt = latestActivity(session)
  try {
    const result = await api(`/api/conversation?sessionId=${encodeURIComponent(session.sessionId)}&limit=${PAGE_SIZE}`)
    if (!Array.isArray(result.messages)) throw new Error('No conversation')
    const firstOffset = result.messages[0]?.offset ?? Infinity
    const kept = conversation.messages.filter(message => message.offset < firstOffset)
    // More turns came than one page holds: what was shown no longer joins up.
    const hasGap = kept.length && result.hasMore && result.before > kept.at(-1).offset
    conversation.messages = hasGap ? result.messages : [...kept, ...result.messages]
    if (!conversation.isLoaded || hasGap) Object.assign(conversation, { before: result.before, hasMore: result.hasMore })
    conversation.isLoaded = true
    conversation.hasFailed = false
  } catch {
    conversation.hasFailed = true
  } finally {
    conversation.isLoading = false
  }
  rerender()
}

// The page before the oldest one shown, keeping the reader's place.
async function loadOlder(sessionId) {
  const conversation = conversationOf(sessionId)
  if (!conversation.isLoaded || !conversation.hasMore || conversation.isLoading) return
  conversation.isLoading = true
  rerender()
  try {
    const result = await api(`/api/conversation?sessionId=${encodeURIComponent(sessionId)}&limit=${PAGE_SIZE}&before=${conversation.before}`)
    if (Array.isArray(result.messages)) {
      conversation.messages = [...result.messages, ...conversation.messages]
      Object.assign(conversation, { before: result.before, hasMore: result.hasMore })
    }
  } catch {} finally {
    conversation.isLoading = false
  }
  const body = document.querySelector('#session-pane .pane-body')
  const fromBottom = body ? body.scrollHeight - body.scrollTop : 0
  rerender()
  const newBody = document.querySelector('#session-pane .pane-body')
  if (newBody && fromBottom) newBody.scrollTop = newBody.scrollHeight - fromBottom
}

// The conversation's bubbles for the pane, or null until the first page is in
// (or when it cannot be read): the pane then shows the last exchange it has.
// Asks for the newest page whenever the session has said something since.
export function conversationHtml(session, id) {
  const conversation = conversationOf(session.sessionId)
  const isStale = latestActivity(session) > conversation.seenAt
  if (!conversation.isLoading && (!conversation.isLoaded ? !conversation.hasFailed || isStale : isStale)) loadNewest(session)
  if (!conversation.isLoaded || !conversation.messages.length) return null
  const top = conversation.hasMore
    ? `<div class="thread-top"><button type="button" class="btn small" data-load-earlier="${id}"${conversation.isLoading ? ' disabled' : ''}>${conversation.isLoading ? 'Loading…' : 'Earlier messages'}</button></div>`
    : '<div class="thread-top">Start of the conversation</div>'
  return top + conversation.messages.map(message => messageBubble(message, session.sessionId + ':' + message.offset)).join('')
}

// What a working session is doing, read from its transcript while its chat is
// open, at most every two seconds.
const activityReads = {}
async function loadActivity(sessionId) {
  activityReads[sessionId] = Date.now()
  try {
    const result = await api('/api/activity?sessionId=' + encodeURIComponent(sessionId))
    const previous = state.activity[sessionId]
    state.activity[sessionId] = typeof result.text === 'string' ? { text: result.text, at: result.at || 0 } : null
    if (previous?.text !== state.activity[sessionId]?.text) rerender()
  } catch {}
}

// The loader while it works: what Claude is doing, in its own words where it
// gave some, and for how long, as a small shimmering status line rather than a
// bubble, so it reads as live and not as a reply. The typing dots alone until
// there is something to say.
const SHIMMER_MS = 1800
const SPIN_MS = 900
export function workingStatus(session) {
  if (Date.now() - (activityReads[session.sessionId] || 0) >= ACTIVITY_EVERY_MS) loadActivity(session.sessionId)
  const activity = state.activity[session.sessionId]
  const dots = '<i></i><i></i><i></i>'
  if (!activity?.text) return `<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="bubble typing" aria-label="Claude is working">${dots}</div></div>`
  const since = activity.at ? `<span class="since">${timeAgo(activity.at)}</span>` : ''
  // The pane is drawn again every two seconds; starting each animation part
  // way through keeps it moving smoothly instead of jumping back to the start.
  const phase = period => `animation-delay: -${Date.now() % period}ms`
  return `<div class="live-status" role="status" aria-live="polite"><span class="spinner" style="${phase(SPIN_MS)}" aria-hidden="true"></span><span class="what" style="${phase(SHIMMER_MS)}">${escapeHtml(activity.text)}</span>${since}</div>`
}

export function initConversation(renderLive) {
  rerender = renderLive
  const pane = document.getElementById('session-pane')
  // The pane body is drawn again every refresh, so listen on the pane; scroll
  // events do not bubble, hence the capture.
  pane.addEventListener('scroll', event => {
    if (event.target.classList?.contains('pane-body') && event.target.scrollTop < LOAD_EDGE_PX) loadOlder(pane.dataset.session)
  }, true)
  pane.addEventListener('click', event => {
    const button = event.target.closest('[data-load-earlier]')
    if (button) loadOlder(button.dataset.loadEarlier)
  })
}
