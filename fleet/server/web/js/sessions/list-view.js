import { $ } from '../core/dom.js'
import { ago, clock, esc, fmtCost, fmtTokens, shortModel } from '../core/format.js'
import { MODEL_ALIASES, modelColor } from '../core/models.js'
import { state } from '../core/state.js'
import { matchesFilter } from './filters.js'
import { STATUS, byName } from './tree.js'

// ---------------------------------------------------------- List view --
// Every session down the left: whoever waits for you pinned on top, then those
// working (or delegating to helpers), then the rest. Inside a group sessions keep
// their place by name, and a child session sits under its parent when both are in
// the same group; otherwise it says whose it is.
export const isListView = () => state.view === 'list'
function navDot(s, below) {
  const isQuiet = s.status === 'idle' || s.status === 'shell'
  if (isQuiet && below && below.working + below.waiting) return `delegating ${below.waiting ? 'needs' : ''}`
  return { waiting: 'waiting', busy: 'busy', shell: 'shell' }[s.status] || ''
}
function navItem(s, depth, byId, belowOf) {
  const id = esc(s.sessionId)
  const below = belowOf.get(s.sessionId)
  const runningSubagents = (s.subagents || []).filter(a => a.isRunning).length
  const runningShells = (s.shells || []).length
  const parent = s.parentSessionId && byId.get(s.parentSessionId)
  const badges = [
    s.hidden ? '<span class="tag hidden-tag" title="Runs hidden in Claude Code\'s background service: no terminal tab">hidden</span>' : !s.tty ? '<span class="tag">headless</span>' : '',
    runningSubagents ? `<span class="tag">${runningSubagents} subagent${runningSubagents > 1 ? 's' : ''}</span>` : '',
    runningShells ? `<span class="tag shell-kind" title="${esc((s.shells || []).map(shell => shell.description || shell.command).join('\n'))}">${runningShells} shell${runningShells > 1 ? 's' : ''}</span>` : '',
    parent && !depth ? `<span title="Started by ${esc(parent.name)}">↳ ${esc(parent.name)}</span>` : '',
  ].join('')
  const opener = s.hidden
    ? `<button class="btn small nav-open" data-attach="${id}" aria-label="Open in terminal" title="Open it in a new terminal tab with claude attach ${esc(s.jobId)}; it keeps running hidden when you close that tab">↗</button>`
    : s.tty
    ? `<button class="btn small nav-open" data-focus="${id}" aria-label="Open tab" title="Bring its terminal tab to the front">↗</button>`
    : `<button class="btn small nav-open" disabled aria-label="No tab" title="Runs without a terminal${s.launcher ? ', started by ' + esc(s.launcher) : ''}">↗</button>`
  const isOpen = state.open.has(s.sessionId)
  const look = STATUS[s.status]?.label || s.status || ''
  return `<div class="nav-item ${isOpen ? 'selected' : ''} ${s.status === 'waiting' ? 'waiting' : ''} ${depth ? 'child' : ''}" data-id="${id}" role="option" aria-selected="${isOpen}">
    <i class="nav-dot ${navDot(s, below)}" title="${esc(s.status === 'waiting' && s.waitingFor ? s.waitingFor : look)}"></i>
    <div class="nav-main">
      <div class="nav-line"><span class="nav-name" title="${esc(s.name)}">${esc(s.name)}</span><span class="chip"><i class="sw" style="background:${modelColor(s.model)}"></i>${esc(shortModel(s.model))}</span></div>
      <div class="nav-sub"><span class="folder" title="${esc(s.cwd || s.folder)}">${esc(s.folder)}</span>${badges}</div>
      <div class="nav-ctx" data-tip="${fmtTokens(s.contextTokens)} of ${fmtTokens(s.contextWindow)} tokens"><div class="track"><b class="${s.contextPercent >= 80 ? 'hot' : ''}" style="width:${s.contextPercent}%"></b></div><span>${s.contextPercent}%</span></div>
    </div>
    ${opener}
  </div>`
}
// Every session in alphabetical order, each child session indented under the
// session that started it. Whoever waits for you keeps its ring, not a section.
export function renderNav(sessions, byId, childrenOf, belowOf) {
  const list = $('#nav-list')
  const shown = sessions.filter(matchesFilter)
  const isShown = new Set(shown.map(s => s.sessionId))
  const order = []
  const items = []
  const visit = (s, depth) => {
    order.push(s.sessionId)
    items.push(navItem(s, depth, byId, belowOf))
    if (depth > 5) return
    for (const child of (childrenOf.get(s.sessionId) || []).slice().sort(byName)) if (isShown.has(child.sessionId)) visit(child, depth + 1)
  }
  shown.filter(s => !isShown.has(s.parentSessionId)).sort(byName).forEach(s => visit(s, 0))
  const html = items.join('') || `<div class="nav-empty">${sessions.length ? 'No session matches.' : 'No Claude Code sessions are running.'}</div>`
  if (list.innerHTML !== html) { const top = list.scrollTop; list.innerHTML = html; list.scrollTop = top }
  return order
}
// The selected session's own figures, beside its chat.
export function renderSide(byId, belowOf) {
  const holder = $('#side-session')
  const s = byId.get([...state.open][0])
  let html
  if (!s) html = '<h3>This session</h3><div class="stamp">Pick a session on the left.</div>'
  else {
    const subagents = (s.subagents || []).filter(a => a.isRunning)
    const shells = s.shells || []
    const hot = s.contextPercent >= 80
    html = `
      <h3>This session<span title="${esc(s.name)}">${esc(s.name)}</span></h3>
      <div class="side-meter">
        <div class="row"><span class="big">${s.contextPercent}%</span><span class="of">${fmtTokens(s.contextTokens)} of ${fmtTokens(s.contextWindow)} tokens</span></div>
        <div class="track"><b class="${hot ? 'hot' : ''}" style="width:${s.contextPercent}%"></b></div>
      </div>
      <dl class="kv">
        <dt>Model</dt><dd><span class="chip"><i class="sw" style="background:${modelColor(s.model)}"></i>${esc(shortModel(s.model))}</span></dd>
        <dt>Today</dt><dd>${fmtTokens(s.todayTokens)} tokens · ${fmtCost(s.todayCost)}</dd>
        <dt>Last activity</dt><dd>${s.lastActivityAt ? ago(s.lastActivityAt) + ' ago' : '—'}</dd>
        <dt>Started</dt><dd>${s.startedAt ? clock(s.startedAt) + ' · ' + ago(s.startedAt) + ' ago' : '—'}</dd>
        <dt>Files edited</dt><dd>${(s.filesTouched || []).length}</dd>
      </dl>
      ${subagents.length ? `<div class="side-list"><h4>Subagents running · ${subagents.length}</h4>${subagents.map(a => `<div class="item"><b title="${esc(a.description)}">${esc(a.description)}</b><span>${esc(a.agentType || 'subagent')}${a.model ? ' · ' + esc(shortModel(MODEL_ALIASES[a.model] || a.model)) : ''} · for ${ago(a.startedAt)}</span></div>`).join('')}</div>` : ''}
      ${shells.length ? `<div class="side-list"><h4>Background shells · ${shells.length}</h4>${shells.map(shell => `<div class="item"><b title="${esc(shell.command)}">${esc(shell.description || shell.command || 'Background shell')}</b>${shell.lastOutput ? `<code title="${esc(shell.lastOutput)}">${esc(shell.lastOutput)}</code>` : `<span>for ${ago(shell.startedAt)}</span>`}</div>`).join('')}</div>` : ''}`
  }
  if (holder.innerHTML !== html) holder.innerHTML = html
}
