// The Reports tab's panels drawn as HTML: context fill, the 24-hour timeline,
// projects and the messages sent from here.

import { $ } from '../core/dom.js'
import { clock, duration, escapeHtml, fillLevel, formatCost, formatTokens, timeAgo } from '../core/format.js'
import { state } from '../core/state.js'

export function renderContextBars() {
  const sessions = (state.live?.sessions || []).slice().sort((first, second) => second.contextPercent - first.contextPercent)
  $('#context-bars').innerHTML = sessions.map(session => `
    <div class="bar-row" data-tip="${escapeHtml(session.name)}: ${formatTokens(session.contextTokens)} of ${formatTokens(session.contextWindow)} tokens">
      <span class="lbl">${escapeHtml(session.name)}</span>
      <div class="track"><b class="${fillLevel(session.contextPercent)}" style="width:${session.contextPercent}%"></b><s></s></div>
      <span class="v">${session.contextPercent}% · ${formatTokens(session.contextTokens)}</span>
    </div>`).join('') || '<div class="empty">No live sessions</div>'
}

export function renderTimeline() {
  const report = state.report
  if (!report) return
  const now = report.generatedAt, start = now - 24 * 3600e3, span = now - start
  const positionOf = time => ((Math.max(start, Math.min(now, time)) - start) / span) * 100
  // Every live session, then the most recently active of the rest.
  const lastActive = row => row.active.length ? row.active[row.active.length - 1][1] : 0
  const liveRows = report.timeline.filter(row => row.isLive)
  const recent = report.timeline.filter(row => !row.isLive && row.active.length).sort((left, right) => lastActive(right) - lastActive(left))
  const rows = [...liveRows, ...recent.slice(0, 6)]
  const ticks = []
  const first = new Date(start); first.setMinutes(0, 0, 0)
  for (let tick = first.getTime() + 3600e3; tick < now - 1800e3; tick += 3 * 3600e3) ticks.push(tick)
  const grid = ticks.map(tick => `<i style="left:${positionOf(tick)}%"></i>`).join('') + `<i class="now" style="left:100%"></i>`
  $('#timeline').innerHTML = `
    <div class="tl-grid">${grid}</div>
    ${rows.map(row => `
      <div class="tl-row">
        <span class="lbl ${row.isLive ? 'live' : ''}" title="${escapeHtml(row.name)}">${escapeHtml(row.name)}</span>
        <div class="tl-track">
          ${row.active.map(([workStart, workEnd]) => `<b style="left:${positionOf(workStart)}%;width:${Math.max(0.15, positionOf(workEnd) - positionOf(workStart))}%" data-tip="${escapeHtml(row.name)} · working ${clock(workStart)}–${clock(workEnd)} (${duration(workEnd - workStart)})"></b>`).join('')}
          ${row.status.filter(segment => segment.status === 'waiting').map(segment => `<b class="wait" style="left:${positionOf(segment.start)}%;width:${Math.max(0.15, positionOf(segment.end) - positionOf(segment.start))}%" data-tip="${escapeHtml(row.name)} · waited ${duration(segment.end - segment.start)} for you from ${clock(segment.start)}"></b>`).join('')}
        </div>
        <span class="waited" title="Waited for you today">${row.waitedTodayMs ? duration(row.waitedTodayMs) : ''}</span>
      </div>`).join('') || '<div class="empty">No activity in the last 24 hours</div>'}
    <div class="tl-axis"><span></span><div class="tl-ticks">${ticks.map(tick => `<span style="left:${positionOf(tick)}%">${new Date(tick).toLocaleTimeString([], { hour: 'numeric' })}</span>`).join('')}</div><span class="waited">waited today</span></div>`
  $('#timeline-note').textContent = `Working time comes from the transcripts. “Waiting for you” is recorded by the dashboard server, so it starts ${new Date(report.statusLogSince).toLocaleString()}.`
}

export function renderProjects() {
  const report = state.report
  if (!report) return
  $('#project-rows').innerHTML = report.projects.map(project => `
    <tr>
      <td><div class="name">${escapeHtml(project.project)}</div><div class="where"><code>${escapeHtml(project.cwd)}</code></div></td>
      <td class="num">${project.sessions}</td><td class="num">${project.prompts}</td><td class="num">${formatTokens(project.tokens)}</td>
      <td class="num">${formatCost(project.cost)}</td><td class="num">${project.commits}</td><td class="num">${project.files}</td>
      <td class="hide-sm"><div class="tags">${project.branches.slice(0, 2).map(branch => `<span class="tag">${escapeHtml(branch)}</span>`).join('')}${project.branches.length > 2 ? `<span class="tag">+${project.branches.length - 2}</span>` : ''}</div></td>
      <td class="hide-sm"><div class="tags">${project.topTools.slice(0, 3).map(usage => `<span class="tag">${escapeHtml(usage.tool)} ${usage.count}</span>`).join('')}</div></td>
    </tr>`).join('') || '<tr><td colspan="9" class="empty">No activity in this range</td></tr>'
  document.querySelectorAll('[data-range-hint]').forEach(hint => { hint.textContent = state.range === 'today' ? 'today' : 'last 7 days' })
}

export function renderFeed() {
  const list = (state.live?.deliveries || []).slice().reverse()
  $('#feed').innerHTML = list.map(delivery => `
    <div><span>${delivery.isDelivered ? '✓' : '✕'}</span>
      <span class="msg"><b>${escapeHtml(delivery.name)}</b> · ${escapeHtml(delivery.via)} · “${escapeHtml(delivery.text)}”${delivery.reason ? ' — ' + escapeHtml(delivery.reason) : ''}</span>
      <span class="t">${timeAgo(delivery.at)} ago</span></div>`).join('') || '<div class="empty" style="display:block">Nothing sent yet. Open a session in the list and message it from there.</div>'
}
