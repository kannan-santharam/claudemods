// A session's conversation in its pane, read from its transcript on demand: the
// newest ten turns first, older ones as the chat is scrolled up, and while it
// works, the sentence the live view carries on what it is doing. A subagent's
// conversation is shown the same way, keyed by session and agent. What has been
// shown is held in this page's memory only; nothing is saved anywhere.

import { api } from '../core/api.js'
import { escapeHtml, timeAgo } from '../core/format.js'
import { markdown } from '../core/markdown.js'
import { state } from '../core/state.js'

const PAGE_SIZE = 10
// Scrolled this close to the top, the chat fetches the page before.
const LOAD_EDGE_PX = 120
// Set by initConversation: draws the Sessions tab again once a page arrives.
let rerender = () => {}

// What a conversation belongs to: a session, or `{ sessionId, agentId, lastAt }`
// for one of its subagents.
export const conversationKey = target => target.sessionId + (target.agentId ? ':' + target.agentId : '')
function conversationOf(target) {
  const key = conversationKey(target)
  state.conversations[key] ||= { sessionId: target.sessionId, agentId: target.agentId || '', messages: [], before: 0, hasMore: false, isLoaded: false, isLoading: false, hasFailed: false, seenAt: 0 }
  return state.conversations[key]
}
const latestActivity = target => (target.agentId ? target.lastAt || 0 : Math.max(target.lastPromptAt || 0, target.lastReplyAt || 0))
const queryOf = conversation => `sessionId=${encodeURIComponent(conversation.sessionId)}${conversation.agentId ? '&agentId=' + encodeURIComponent(conversation.agentId) : ''}`

// One bubble: your prompt on the right, Claude's reply on the left. `key` tells
// each reply apart, so its own scroll survives the 2-second refresh. In a
// subagent's conversation the right-hand side is its session, named by `from`.
// `tick` is the mark beside a message of yours that was sent from this page.
export function messageBubble(message, key, from = 'You', tick = '') {
  const stamp = message.at ? ' · ' + timeAgo(message.at) + ' ago' : ''
  return message.from === 'you'
    ? `<div class="msg you" data-key="you:${escapeHtml(key)}"><div class="bubble">${from === 'You' ? `<span class="mine">${escapeHtml(message.text)}</span>` : escapeHtml(message.text)}</div><div class="stamp">${escapeHtml(from)}${stamp}${tick ? ' ' + tick : ''}</div></div>`
    : `<div class="msg claude" data-key="claude:${escapeHtml(key)}"><span class="avatar" aria-hidden="true">C</span><div><div class="bubble md" data-reply="${escapeHtml(key)}">${markdown(message.text)}</div><div class="stamp">Claude${stamp}</div></div></div>`
}

// The newest page, laid over what is shown: turns from its first one on are
// replaced, so a reply still being written grows in place.
async function loadNewest(target, seenAt = latestActivity(target)) {
  const conversation = conversationOf(target)
  conversation.isLoading = true
  conversation.seenAt = seenAt
  try {
    const result = await api(`/api/conversation?${queryOf(conversation)}&limit=${PAGE_SIZE}`)
    if (!Array.isArray(result.messages)) throw new Error('No conversation')
    const firstOffset = result.messages[0]?.offset ?? Infinity
    const kept = conversation.messages.filter(message => message.offset < firstOffset)
    // The page begins after everything shown: more turns came than one page
    // holds, so what was shown no longer joins up with it.
    const lastShown = conversation.messages.at(-1)?.offset ?? -1
    const hasGap = kept.length && result.hasMore && firstOffset > lastShown
    // Also the first page that holds anything: a session's first read can come
    // before the server has found its transcript, and is then empty.
    const isFirstPage = !conversation.isLoaded || !conversation.messages.length
    conversation.messages = hasGap ? result.messages : [...kept, ...result.messages]
    if (isFirstPage || hasGap) Object.assign(conversation, { before: result.before, hasMore: result.hasMore })
    conversation.isLoaded = true
    conversation.hasFailed = false
  } catch {
    conversation.hasFailed = true
  } finally {
    conversation.isLoading = false
  }
  // The transcript changed again while this page was on its way.
  rerender()
  if (conversation.isReloadWanted) {
    conversation.isReloadWanted = false
    loadNewest(conversation, conversation.seenAt)
  }
}
// The server says the transcript has new lines (push.js): read the newest page
// now, without waiting for the live view to notice.
export function reloadConversation(key) {
  const conversation = state.conversations[key]
  if (!conversation?.isLoaded) return
  if (conversation.isLoading) conversation.isReloadWanted = true
  else loadNewest(conversation, conversation.seenAt)
}

// The page before the oldest one shown, keeping the reader's place.
export async function loadOlder(key) {
  const conversation = state.conversations[key]
  if (!conversation?.isLoaded || !conversation.hasMore || conversation.isLoading) return
  conversation.isLoading = true
  rerender()
  try {
    const result = await api(`/api/conversation?${queryOf(conversation)}&limit=${PAGE_SIZE}&before=${conversation.before}`)
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
// Asks for the newest page whenever the session (or subagent) has said
// something since. `from` names the right-hand side, and `tickOf` gives the
// mark for a message of yours.
export const shownMessages = target => state.conversations[conversationKey(target)]?.messages || []
export function conversationHtml(target, from, tickOf = () => '') {
  const conversation = conversationOf(target)
  const key = conversationKey(target)
  const isStale = latestActivity(target) > conversation.seenAt
  if (!conversation.isLoading && (!conversation.isLoaded ? !conversation.hasFailed || isStale : isStale)) loadNewest(target)
  if (!conversation.isLoaded || !conversation.messages.length) return null
  const top = conversation.hasMore
    ? `<div class="thread-top"><button type="button" class="btn small" data-load-earlier="${escapeHtml(key)}"${conversation.isLoading ? ' disabled' : ''}>${conversation.isLoading ? 'Loading…' : 'Earlier messages'}</button></div>`
    : '<div class="thread-top">Start of the conversation</div>'
  return top + conversation.messages.map(message => messageBubble(message, key + ':' + message.offset, from, tickOf(message))).join('')
}

// The loader while it works: what Claude is doing, in its own words where it
// gave some, and for how long, as a small shimmering status line rather than a
// bubble, so it reads as live and not as a reply. The typing dots alone until
// there is something to say.
export const SHIMMER_MS = 1800
const SPIN_MS = 900
// The page is drawn again every two seconds; starting an animation part way
// through keeps it moving smoothly instead of jumping back to the start.
export const animationPhase = period => `animation-delay: -${Date.now() % period}ms`
export function workingStatus(session) {
  const activity = session.activity
  const dots = '<i></i><i></i><i></i>'
  if (!activity?.text) return `<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="bubble typing" aria-label="Claude is working">${dots}</div></div>`
  const since = activity.at ? `<span class="since">${timeAgo(activity.at)}</span>` : ''
  return `<div class="live-status" role="status" aria-live="polite"><span class="spinner" data-steady style="${animationPhase(SPIN_MS)}" aria-hidden="true"></span><span class="what" data-steady style="${animationPhase(SHIMMER_MS)}">${escapeHtml(activity.text)}</span>${since}</div>`
}

// The reply a connected session is writing right now, as far as its mod has
// reported it (push.js), as one more bubble at the end. It goes once the
// transcript holds the text, which the conversation then shows as usual; once
// anything newer has been said or sent (a reply that was stopped stays where it
// was cut off, it does not trail the next prompt); or a while after the writing
// stopped without either.
const STREAM_LINGER_MS = 15000
const STREAM_QUIET_MS = 60000
const STREAM_MATCH_CHARS = 40
// Pieces of a reply come a few times a second; this long without one, while
// something newer is in the chat, and the writing has stopped.
const STREAM_STEP_MS = 2500
const squashed = text => text.replace(/\s+/g, '')
export function streamingBubble(sessionId, messages) {
  const stream = state.streams[sessionId]
  const text = stream?.text?.trim()
  if (!text) return ''
  const age = Date.now() - stream.receivedAt
  if (age > (stream.isDone ? STREAM_LINGER_MS : STREAM_QUIET_MS)) return ''
  // Said or sent since its last piece: at once for a reply that has ended, and
  // for one still being written only once no further piece has followed.
  const isNewer = at => at > stream.receivedAt && (stream.isDone || age > STREAM_STEP_MS)
  if (messages.some(message => isNewer(message.at || 0)) || (state.outbox[sessionId] || []).some(entry => isNewer(entry.at))) return ''
  // In the transcript already: its end is there, or for a reply too long to be
  // shown whole, its beginning. Only a reply from after this one began counts
  // (the one before may have said the same), and a few words still being
  // written prove nothing.
  const written = squashed(text)
  const shown = squashed(messages.findLast(message => message.from === 'claude' && (message.at || 0) >= stream.startedAt - 1000)?.text || '')
  if ((stream.isDone || written.length >= STREAM_MATCH_CHARS) && (shown.includes(written.slice(-160)) || (written.length > 2000 && shown.includes(written.slice(0, 160))))) return ''
  return `<div class="msg claude streaming" data-key="claude:stream"><span class="avatar" aria-hidden="true">C</span><div><div class="bubble md">${markdown(text)}</div><div class="stamp">Claude · ${stream.isDone ? 'just now' : 'writing…'}</div></div></div>`
}

// Replies that arrived below while you were reading further up. A conversation
// is read up to its newest message whenever its end is in view; what came
// after that is counted on a tag at the bottom of the chat, which takes you
// there. Kept in this page's memory only.
const isAtEnd = body => body.scrollTop + body.clientHeight >= body.scrollHeight - 8
export function markRead(key) {
  const conversation = state.conversations[key]
  if (conversation?.isLoaded) conversation.readAt = Math.max(0, ...conversation.messages.map(message => message.at || 0))
}
export function newBelowHtml(key) {
  const conversation = state.conversations[key]
  if (!conversation?.isLoaded || conversation.readAt == null) return ''
  const count = conversation.messages.filter(message => message.from === 'claude' && (message.at || 0) > conversation.readAt).length
  return count ? `<button type="button" class="new-below" data-jump-newest>↓ ${count} new message${count > 1 ? 's' : ''}</button>` : ''
}
// Called once the chat is drawn and scrolled: with its end in view, it is read.
export function settleRead(pane) {
  const body = pane.querySelector('.pane-body')
  if (!body || !pane.dataset.conversation || !isAtEnd(body)) return
  markRead(pane.dataset.conversation)
  pane.querySelector('.new-below')?.remove()
}

export function initConversation(renderLive) {
  rerender = renderLive
  const pane = document.getElementById('session-pane')
  // The pane body is drawn again every refresh, so listen on the pane; scroll
  // events do not bubble, hence the capture.
  pane.addEventListener('scroll', event => {
    if (!event.target.classList?.contains('pane-body')) return
    if (event.target.scrollTop < LOAD_EDGE_PX && pane.dataset.conversation) loadOlder(pane.dataset.conversation)
    settleRead(pane)
  }, true)
  pane.addEventListener('click', event => {
    const button = event.target.closest('[data-load-earlier]')
    if (button) loadOlder(button.dataset.loadEarlier)
    if (event.target.closest('[data-jump-newest]')) { const body = pane.querySelector('.pane-body'); body.scrollTop = body.scrollHeight; settleRead(pane) }
  })
}
