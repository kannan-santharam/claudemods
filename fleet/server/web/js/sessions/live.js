// Rendering the Sessions tab: the table rows, the list, the pane and the side
// column, keeping focus, caret and scroll across each 2-second refresh.

import { $ } from '../core/dom.js'
import { escapeHtml, fillLevel, formatCost, formatTokens, shortModel, timeAgo } from '../core/format.js'
import { modelColor } from '../core/models.js'
import { state } from '../core/state.js'
import { renderBulkbar } from '../dialogs/end-session.js'
import { matchesFilter, renderFilters } from './filters.js'
import { fitSplit } from './layout.js'
import { isListView, renderNav, renderSide } from './list-view.js'
import { renderPane } from './pane.js'
import { shellRows, subagentRows } from './table.js'
import { byName, sessionTree, statusPill } from './tree.js'

export function selectSession(sessionId) {
  state.open = new Set([sessionId])
  renderLive()
  document.querySelector(isListView() ? `.nav-item[data-id="${CSS.escape(sessionId)}"]` : `tr.session[data-id="${CSS.escape(sessionId)}"]`)?.scrollIntoView({ block: 'nearest' })
}

export function renderLive() {
  const sessions = state.live?.sessions || []
  const connected = sessions.filter(session => session.hasMod).length
  $('#live-hint').textContent = `${connected} of ${sessions.length} connected through the fleet mod`
  const rows = []
  const { byId, childrenOf, roots, belowOf } = sessionTree(sessions)
  renderFilters(sessions)
  const ordered = []
  const visit = (session, depth) => {
    ordered.push({ session, depth })
    if (state.collapsed.has(session.sessionId) || depth > 5) return
    for (const child of childrenOf.get(session.sessionId) || []) visit(child, depth + 1)
  }
  // A filter or a search lists the matching sessions flat; otherwise the tree.
  const isFiltered = state.filter !== 'all' || state.search.trim()
  if (isFiltered) sessions.filter(matchesFilter).sort(byName).forEach(session => ordered.push({ session, depth: 0 }))
  else roots.forEach(session => visit(session, 0))
  state.visible = ordered.map(item => item.session.sessionId)
  // One session is shown on the right: the one picked, else the first waiting for you, else the first row.
  const picked = [...state.open][0]
  if (!picked || !byId.has(picked)) {
    const fallback = sessions.find(session => session.status === 'waiting') || (isListView() ? sessions.filter(session => session.status === 'busy').sort(byName)[0] : null) || ordered[0]?.session
    state.open = new Set(fallback ? [fallback.sessionId] : [])
  }
  for (const { session, depth } of ordered) {
    const isOpen = state.open.has(session.sessionId)
    const childCount = (childrenOf.get(session.sessionId) || []).length
    const runningSubagents = session.subagents.filter(agent => agent.isRunning).length
    const runningShells = (session.shells || []).length
    const isCollapsed = state.collapsed.has(session.sessionId)
    const nestedLabel = [
      runningSubagents ? `${runningSubagents} subagent${runningSubagents > 1 ? 's' : ''} running` : '',
      runningShells ? `${runningShells} background shell${runningShells > 1 ? 's' : ''}` : '',
      childCount ? `${childCount} child session${childCount > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · ')
    const id = escapeHtml(session.sessionId)
    rows.push(`
      <tr class="session ${isOpen ? 'selected' : ''}" data-id="${id}" aria-selected="${isOpen}">
        <td><input type="checkbox" data-select="${id}" ${state.selected.has(session.sessionId) ? 'checked' : ''} aria-label="Select ${escapeHtml(session.name)}"></td>
        <td>${statusPill(session, belowOf.get(session.sessionId))}</td>
        <td>
          <div class="nested" style="padding-left:${depth * 22}px">${depth ? '<span class="branch">↳</span>' : ''}<div>
          <div class="name">${escapeHtml(session.name)} <span class="link ${session.hasMod ? 'on' : ''}" aria-label="${session.hasMod ? 'connected' : 'not connected'}" title="${session.hasMod ? 'Connected: exact figures, and messages arrive as a prompt' : 'Started before the mod: figures read from its transcript, and messages are typed into its tab when it is idle'}">${session.hasMod ? 'connected' : 'not connected'}</span>${runningShells ? ` <span class="shell-tag" title="${escapeHtml((session.shells || []).map(shell => shell.description || shell.command).join('\n'))}"><i></i>${runningShells} shell${runningShells > 1 ? 's' : ''} running</span>` : ''}</div>
          <div class="where"><span>${escapeHtml(session.folder)}</span>${session.hidden ? `<span class="tag hidden-tag" title="Runs hidden in Claude Code's background service: no terminal tab">hidden</span><span class="sid" data-copy="${escapeHtml(session.jobId)}" title="Its id (click to copy). claude attach ${escapeHtml(session.jobId)} opens it in a terminal">${escapeHtml(session.jobId)}</span>` : !session.tty ? '<span class="tag">headless</span>' : ''}${depth && session.launcher ? `<span class="tag">started by ${escapeHtml(session.launcher)}</span>` : ''}${nestedLabel ? `<button class="nest" data-toggle="${id}" aria-expanded="${!isCollapsed}">${isCollapsed ? '▸' : '▾'} ${escapeHtml(nestedLabel)}</button>` : ''}</div>
          </div></div>
        </td>
        <td class="hide-sm"><span class="chip"><i class="sw" style="background:${modelColor(session.model)}"></i>${escapeHtml(shortModel(session.model))}</span></td>
        <td><div class="meter-cell">
          <div class="meter" data-tip="${formatTokens(session.contextTokens)} of ${formatTokens(session.contextWindow)} tokens"><div class="track"><b class="${fillLevel(session.contextPercent)}" style="width:${session.contextPercent}%"></b></div><span>${session.contextPercent}%</span></div>
        </div></td>
        <td class="num hide-sm today">${formatTokens(session.todayTokens)} · ${formatCost(session.todayCost)}</td>
        <td class="num hide-sm">${timeAgo(session.lastActivityAt)}</td>
        <td class="tab-col">${session.hidden
          ? `<button class="btn small" data-attach="${id}" title="Open it in a new terminal tab with claude attach ${escapeHtml(session.jobId)}; it keeps running hidden when you close that tab">Terminal ↗</button>`
          : session.tty
          ? `<button class="btn small" data-focus="${id}" title="Bring its terminal tab to the front">Open tab ↗</button>`
          : `<button class="btn small" disabled title="Runs without a terminal${session.launcher ? ', started by ' + escapeHtml(session.launcher) : ''}">No tab</button>`}</td>
      </tr>`)
    if (!isCollapsed) rows.push(subagentRows(session, depth), shellRows(session, depth))
  }
  const body = $('#live-rows')
  const pane = $('#session-pane')
  const area = $('#view-sessions')
  // Keep the caret where it was in a message being typed across a refresh.
  const active = document.activeElement
  const keyAttr = active && active.dataset ? (active.dataset.draft !== undefined ? 'draft' : active.dataset.field !== undefined ? 'field' : '') : ''
  const keyValue = keyAttr ? active.dataset[keyAttr] : ''
  const caret = keyAttr && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null
  // A reply being read keeps its scroll position across the 2-second refresh, and so does the pane.
  const replyScroll = new Map([...area.querySelectorAll('[data-reply]')].map(reply => [reply.dataset.reply, reply.scrollTop]))
  const paneBody = pane.querySelector('.pane-body')
  const paneScroll = paneBody && pane.dataset.session === [...state.open][0] ? { top: paneBody.scrollTop, atEnd: paneBody.scrollTop + paneBody.clientHeight >= paneBody.scrollHeight - 8 } : null
  body.innerHTML = rows.join('') || `<tr><td colspan="8" class="empty">${sessions.length ? 'No session matches.' : 'No Claude Code sessions are running.'}</td></tr>`
  // The List view's column, in its own order, which j and k then follow.
  const navOrder = renderNav(sessions, byId, childrenOf, belowOf)
  if (isListView()) state.visible = navOrder
  renderPane(byId, belowOf)
  renderSide(byId)
  // Size the split before scrolling the chat, so it lands on the newest message.
  fitSplit()
  const newBody = pane.querySelector('.pane-body')
  if (newBody) newBody.scrollTop = paneScroll && !paneScroll.atEnd ? paneScroll.top : newBody.scrollHeight
  for (const reply of area.querySelectorAll('[data-reply]')) if (replyScroll.has(reply.dataset.reply)) reply.scrollTop = replyScroll.get(reply.dataset.reply)
  if (keyAttr) {
    const field = area.querySelector(`[data-${keyAttr}="${CSS.escape(keyValue)}"]`)
    if (field) { field.focus(); if (caret) field.setSelectionRange(caret[0], caret[1]) }
  }
  fitSplit()
  $('#select-all').checked = sessions.length > 0 && sessions.every(session => state.selected.has(session.sessionId))
  renderBulkbar()
}
