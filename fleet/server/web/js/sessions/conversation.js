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
export function messageBubble(message, key, from = 'You') {
  const stamp = message.at ? ' · ' + timeAgo(message.at) + ' ago' : ''
  return message.from === 'you'
    ? `<div class="msg you"><div class="bubble">${escapeHtml(message.text)}</div><div class="stamp">${escapeHtml(from)}${stamp}</div></div>`
    : `<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div><div class="bubble md" data-reply="${escapeHtml(key)}">${markdown(message.text)}</div><div class="stamp">Claude${stamp}</div></div></div>`
}

// The newest page, laid over what is shown: turns from its first one on are
// replaced, so a reply still being written grows in place.
async function loadNewest(target) {
  const conversation = conversationOf(target)
  conversation.isLoading = true
  conversation.seenAt = latestActivity(target)
  try {
    const result = await api(`/api/conversation?${queryOf(conversation)}&limit=${PAGE_SIZE}`)
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
async function loadOlder(key) {
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
// something since. `from` names the right-hand side.
export function conversationHtml(target, from) {
  const conversation = conversationOf(target)
  const key = conversationKey(target)
  const isStale = latestActivity(target) > conversation.seenAt
  if (!conversation.isLoading && (!conversation.isLoaded ? !conversation.hasFailed || isStale : isStale)) loadNewest(target)
  if (!conversation.isLoaded || !conversation.messages.length) return null
  const top = conversation.hasMore
    ? `<div class="thread-top"><button type="button" class="btn small" data-load-earlier="${escapeHtml(key)}"${conversation.isLoading ? ' disabled' : ''}>${conversation.isLoading ? 'Loading…' : 'Earlier messages'}</button></div>`
    : '<div class="thread-top">Start of the conversation</div>'
  return top + conversation.messages.map(message => messageBubble(message, key + ':' + message.offset, from)).join('')
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
  return `<div class="live-status" role="status" aria-live="polite"><span class="spinner" style="${animationPhase(SPIN_MS)}" aria-hidden="true"></span><span class="what" style="${animationPhase(SHIMMER_MS)}">${escapeHtml(activity.text)}</span>${since}</div>`
}

export function initConversation(renderLive) {
  rerender = renderLive
  const pane = document.getElementById('session-pane')
  // The pane body is drawn again every refresh, so listen on the pane; scroll
  // events do not bubble, hence the capture.
  pane.addEventListener('scroll', event => {
    if (event.target.classList?.contains('pane-body') && event.target.scrollTop < LOAD_EDGE_PX && pane.dataset.conversation) loadOlder(pane.dataset.conversation)
  }, true)
  pane.addEventListener('click', event => {
    const button = event.target.closest('[data-load-earlier]')
    if (button) loadOlder(button.dataset.loadEarlier)
  })
}
