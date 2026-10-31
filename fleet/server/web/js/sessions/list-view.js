// The List view: every session down the left, and the selected one's figures
// on the right.

import { $ } from '../core/dom.js'
import { clock, escapeHtml, fillLevel, formatCost, formatTokens, shortModel, timeAgo } from '../core/format.js'
import { MODEL_ALIASES, modelColor } from '../core/models.js'
import { state } from '../core/state.js'
import { remember, remembered } from '../core/storage.js'
import { matchesFilter } from './filters.js'
import { STATUS, byName } from './tree.js'

// Every session down the left: whoever waits for you pinned on top, then those
// working (or delegating to helpers), then the rest. Inside a group sessions keep
// their place by name, and a child session sits under its parent when both are in
// the same group; otherwise it says whose it is.
export const isListView = () => state.view === 'list'
function navDot(session, below) {
  const isQuiet = session.status === 'idle' || session.status === 'shell'
  if (isQuiet && below && below.working + below.waiting) return `delegating ${below.waiting ? 'needs' : ''}`
  return { waiting: 'waiting', busy: 'busy', shell: 'shell' }[session.status] || ''
}
// A reply you have not opened yet: the newest reply time seen per session, in
// this browser only. A session first met counts as read, so a first visit
// lights nothing.
const SEEN_KEY = 'fleet-seen-replies'
const seenReplies = (() => { try { return JSON.parse(remembered(SEEN_KEY) || '{}') } catch { return {} } })()
function hasNewReply(session) {
  const replyAt = session.lastReplyAt || 0
  const isOpen = state.open.has(session.sessionId)
  if (!(session.sessionId in seenReplies) || isOpen) {
    if (seenReplies[session.sessionId] !== replyAt) { seenReplies[session.sessionId] = replyAt; remember(SEEN_KEY, JSON.stringify(seenReplies)) }
    return false
  }
  // While it works, its replies are progress; the turn's end is what counts.
  return session.status !== 'busy' && replyAt > seenReplies[session.sessionId]
}
// How long ago it last did anything, to the minute, so the row is not redrawn every tick.
const lastSeenAgo = session => (Date.now() - (session.lastActivityAt || 0) < 60_000 ? 'just now' : timeAgo(session.lastActivityAt) + ' ago')
// The line under the folder: what it is doing while it works, what it needs while it waits.
function navStatusLine(session) {
  if (session.status === 'waiting') return `<div class="nav-state waiting">Waiting: ${escapeHtml(session.waitingFor || 'for you')}</div>`
  if (session.status === 'busy' && session.activity?.text) return `<div class="nav-state" title="${escapeHtml(session.activity.text)}">${escapeHtml(session.activity.text)}</div>`
  return ''
}
function navItem(session, depth, byId, belowOf) {
  const id = escapeHtml(session.sessionId)
  const below = belowOf.get(session.sessionId)
  const runningSubagents = (session.subagents || []).filter(agent => agent.isRunning).length
  const runningShells = (session.shells || []).length
  const parent = session.parentSessionId && byId.get(session.parentSessionId)
  const badges = [
    session.hidden ? '<span class="tag hidden-tag" title="Runs hidden in Claude Code\'s background service: no terminal tab">hidden</span>' : !session.tty ? '<span class="tag">headless</span>' : '',
    runningSubagents ? `<span class="tag">${runningSubagents} subagent${runningSubagents > 1 ? 's' : ''}</span>` : '',
    runningShells ? `<span class="tag shell-kind" title="${escapeHtml((session.shells || []).map(shell => shell.description || shell.command).join('\n'))}">${runningShells} shell${runningShells > 1 ? 's' : ''}</span>` : '',
    parent && !depth ? `<span title="Started by ${escapeHtml(parent.name)}">↳ ${escapeHtml(parent.name)}</span>` : '',
  ].join('')
  const opener = session.hidden
    ? `<button class="btn small nav-open" data-attach="${id}" aria-label="Open in terminal" title="Open it in a new terminal tab with claude attach ${escapeHtml(session.jobId)}; it keeps running hidden when you close that tab">↗</button>`
    : session.tty
    ? `<button class="btn small nav-open" data-focus="${id}" aria-label="Open tab" title="Bring its terminal tab to the front">↗</button>`
    : `<button class="btn small nav-open" disabled aria-label="No tab" title="Runs without a terminal${session.launcher ? ', started by ' + escapeHtml(session.launcher) : ''}">↗</button>`
  const isOpen = state.open.has(session.sessionId)
  const look = STATUS[session.status]?.label || session.status || ''
  return `<div class="nav-item ${isOpen ? 'selected' : ''} ${session.status === 'waiting' ? 'waiting' : ''} ${depth ? 'child' : ''}" data-id="${id}" role="option" aria-selected="${isOpen}">
    <i class="nav-dot ${navDot(session, below)}" title="${escapeHtml(session.status === 'waiting' && session.waitingFor ? session.waitingFor : look)}"></i>
    <div class="nav-main">
      <div class="nav-line">${hasNewReply(session) ? '<i class="nav-new" title="A new reply you have not opened"></i>' : ''}<span class="nav-name" title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</span><span class="chip"><i class="sw" style="background:${modelColor(session.model)}"></i>${escapeHtml(shortModel(session.model))}</span></div>
      <div class="nav-sub"><span class="folder" title="${escapeHtml(session.cwd || session.folder)}">${escapeHtml(session.folder)}</span>${badges}</div>
      ${navStatusLine(session)}
      <div class="nav-ctx" data-tip="${formatTokens(session.contextTokens)} of ${formatTokens(session.contextWindow)} tokens"><div class="track"><b class="${fillLevel(session.contextPercent)}" style="width:${session.contextPercent}%"></b></div><span>${session.contextPercent}%</span>${session.status === 'busy' ? '' : `<span class="nav-ago">${lastSeenAgo(session)}</span>`}</div>
    </div>
    ${opener}
  </div>`
}
// Every session in alphabetical order, each child session indented under the
// session that started it. Whoever waits for you keeps its ring, not a section.
export function renderNav(sessions, byId, childrenOf, belowOf) {
  const list = $('#nav-list')
  const shown = sessions.filter(matchesFilter)
  const isShown = new Set(shown.map(session => session.sessionId))
  const order = []
  const items = []
  const visit = (session, depth) => {
    order.push(session.sessionId)
    items.push(navItem(session, depth, byId, belowOf))
    if (depth > 5) return
    for (const child of (childrenOf.get(session.sessionId) || []).slice().sort(byName)) if (isShown.has(child.sessionId)) visit(child, depth + 1)
  }
  shown.filter(session => !isShown.has(session.parentSessionId)).sort(byName).forEach(session => visit(session, 0))
  const html = items.join('') || `<div class="nav-empty">${sessions.length ? 'No session matches.' : 'No Claude Code sessions are running.'}</div>`
  if (list.innerHTML !== html) { const top = list.scrollTop; list.innerHTML = html; list.scrollTop = top }
  return order
}
// The selected session's own figures, beside its chat.
export function renderSide(byId) {
  const holder = $('#side-session')
  const session = byId.get([...state.open][0])
  let html
  if (!session) html = '<h3>This session</h3><div class="stamp">Pick a session on the left.</div>'
  else {
    const subagents = (session.subagents || []).filter(agent => agent.isRunning)
    const shells = session.shells || []
    html = `
      <h3>This session<span title="${escapeHtml(session.name)}">${escapeHtml(session.name)}</span></h3>
      <div class="side-meter">
        <div class="row"><span class="big">${session.contextPercent}%</span><span class="of">${formatTokens(session.contextTokens)} of ${formatTokens(session.contextWindow)} tokens</span></div>
        <div class="track"><b class="${fillLevel(session.contextPercent)}" style="width:${session.contextPercent}%"></b></div>
      </div>
      <dl class="kv">
        <dt>Model</dt><dd><span class="chip"><i class="sw" style="background:${modelColor(session.model)}"></i>${escapeHtml(shortModel(session.model))}</span></dd>
        <dt>Today</dt><dd>${formatTokens(session.todayTokens)} tokens · ${formatCost(session.todayCost)}</dd>
        <dt>Last activity</dt><dd>${session.lastActivityAt ? timeAgo(session.lastActivityAt) + ' ago' : '—'}</dd>
        <dt>Started</dt><dd>${session.startedAt ? clock(session.startedAt) + ' · ' + timeAgo(session.startedAt) + ' ago' : '—'}</dd>
        <dt>Files edited</dt><dd>${(session.filesTouched || []).length}</dd>
      </dl>
      ${subagents.length ? `<div class="side-list"><h4>Subagents running · ${subagents.length}</h4>${subagents.map(agent => `<div class="item"><b title="${escapeHtml(agent.description)}">${escapeHtml(agent.description)}</b><span>${escapeHtml(agent.agentType || 'subagent')}${agent.model ? ' · ' + escapeHtml(shortModel(MODEL_ALIASES[agent.model] || agent.model)) : ''} · for ${timeAgo(agent.startedAt)}</span></div>`).join('')}</div>` : ''}
      ${shells.length ? `<div class="side-list"><h4>Background shells · ${shells.length}</h4>${shells.map(shell => `<div class="item"><b title="${escapeHtml(shell.command)}">${escapeHtml(shell.description || shell.command || 'Background shell')}</b>${shell.lastOutput ? `<code title="${escapeHtml(shell.lastOutput)}">${escapeHtml(shell.lastOutput)}</code>` : `<span>for ${timeAgo(shell.startedAt)}</span>`}</div>`).join('')}</div>` : ''}`
  }
  if (holder.innerHTML !== html) holder.innerHTML = html
}
