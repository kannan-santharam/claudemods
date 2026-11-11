// A session's subagents in its pane: every helper it started (running ones
// first), and any one helper's conversation, read from its own transcript the
// way the session's chat is. Helpers take no messages, so there is no message
// box here; what they report goes back to their session.

import { api } from '../core/api.js'
import { escapeHtml, shortModel, timeAgo } from '../core/format.js'
import { aliasedModel } from '../core/models.js'
import { state } from '../core/state.js'
import { conversationHtml, workingStatus } from './conversation.js'

const REFRESH_MS = 2000
// Set by initSubagents: draws the Sessions tab again once the list arrives.
let rerender = () => {}
export function initSubagents(renderLive) { rerender = renderLive }

// The session's subagents, asked for again at most every two seconds while the
// tab is open, and drawn again only when something changed.
function listOf(sessionId) {
  state.subagents[sessionId] ||= { agents: [], fetchedAt: 0, isLoading: false, isLoaded: false }
  const list = state.subagents[sessionId]
  if (!list.isLoading && Date.now() - list.fetchedAt > REFRESH_MS) {
    list.isLoading = true
    api(`/api/subagents?sessionId=${encodeURIComponent(sessionId)}`)
      .then(result => {
        const agents = Array.isArray(result.subagents) ? result.subagents : []
        const hasChanged = !list.isLoaded || JSON.stringify(agents) !== JSON.stringify(list.agents)
        Object.assign(list, { agents, isLoaded: true })
        if (hasChanged) rerender()
      })
      .catch(() => {})
      .finally(() => { list.isLoading = false; list.fetchedAt = Date.now() })
  }
  return list
}

const modelName = agent => (agent.model ? shortModel(aliasedModel(agent.model)) : '')
function agentLine(agent) {
  return [agent.agentType || 'subagent', modelName(agent), agent.isRunning ? `running for ${timeAgo(agent.startedAt)}` : `finished ${timeAgo(agent.lastAt)} ago`].filter(Boolean).map(escapeHtml).join(' · ')
}

function listHtml(session, list) {
  if (!list.isLoaded) return '<div class="pane-empty">Loading its subagents…</div>'
  if (!list.agents.length) return '<div class="pane-empty">This session has not started any subagents.</div>'
  const sessionId = escapeHtml(session.sessionId)
  return `<div class="subagent-list">${list.agents.map(agent => `
    <button type="button" class="subagent-row" data-open-subagent="${escapeHtml(agent.agentId)}" data-session="${sessionId}">
      <i class="nav-dot ${agent.isRunning ? 'busy' : ''}" aria-hidden="true"></i>
      <span class="subagent-main"><b>${escapeHtml(agent.description)}</b><span>${agentLine(agent)}</span>${agent.isRunning && agent.activity?.text ? `<span class="subagent-doing">${escapeHtml(agent.activity.text)}</span>` : ''}</span>
      <span class="subagent-go" aria-hidden="true">›</span>
    </button>`).join('')}</div>`
}

// One subagent's conversation: the task its session gave it on the right, its
// replies on the left, and while it runs, what it is doing.
function agentHtml(session, agent) {
  const target = { sessionId: session.sessionId, agentId: agent.agentId, lastAt: agent.lastAt }
  const thread = conversationHtml(target, `From ${session.name}`) ?? '<div class="stamp">Loading its conversation…</div>'
  return `<div class="subagent-head">
      <button type="button" class="btn small" data-close-subagent="${escapeHtml(session.sessionId)}">‹ All subagents</button>
      <div class="subagent-title"><b>${escapeHtml(agent.description || 'Subagent')}</b><span>${agent.startedAt ? agentLine(agent) : ''}</span></div>
    </div>
    <div class="thread">${thread}${agent.isRunning ? workingStatus(agent) : ''}</div>
    <div class="stamp subagent-note">Subagents take no messages. What it reports goes back to ${escapeHtml(session.name)}.</div>`
}

// What the pane's Subagents tab shows: the list, or the one picked from it.
export function subagentsHtml(session) {
  const list = listOf(session.sessionId)
  const agentId = state.subagent[session.sessionId]
  if (!agentId) return listHtml(session, list)
  // Until the list is in, a running one is known from the live view.
  const agent = list.agents.find(item => item.agentId === agentId) || (session.subagents || []).find(item => item.agentId === agentId)
  return agentHtml(session, agent || { agentId })
}

// The count on the tab: the list once read, else today's from the live view.
export function subagentCount(session) {
  return state.subagents[session.sessionId]?.isLoaded ? state.subagents[session.sessionId].agents.length : session.subagentCount || 0
}
