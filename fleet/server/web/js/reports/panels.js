// The Reports tab's panels drawn as HTML: context fill, the 24-hour timeline,
// projects and the messages sent from here.

import { $ } from '../core/dom.js'
import { ago, clock, duration, esc, fmtCost, fmtTokens } from '../core/format.js'
import { state } from '../core/state.js'

export function renderContextBars() {
  const sessions = (state.live?.sessions || []).slice().sort((a, b) => b.contextPercent - a.contextPercent)
  $('#context-bars').innerHTML = sessions.map(s => `
    <div class="bar-row" data-tip="${esc(s.name)}: ${fmtTokens(s.contextTokens)} of ${fmtTokens(s.contextWindow)} tokens">
      <span class="lbl">${esc(s.name)}</span>
      <div class="track"><b class="${s.contextPercent >= 80 ? 'hot' : ''}" style="width:${s.contextPercent}%"></b><s></s></div>
      <span class="v">${s.contextPercent}% · ${fmtTokens(s.contextTokens)}</span>
    </div>`).join('') || '<div class="empty">No live sessions</div>'
}

export function renderTimeline() {
  const report = state.report
  if (!report) return
  const now = report.generatedAt, start = now - 24 * 3600e3, span = now - start
  const pos = t => ((Math.max(start, Math.min(now, t)) - start) / span) * 100
  // Every live session, then the most recently active of the rest.
  const lastActive = row => row.active.length ? row.active[row.active.length - 1][1] : 0
  const liveRows = report.timeline.filter(row => row.isLive)
  const recent = report.timeline.filter(row => !row.isLive && row.active.length).sort((a, b) => lastActive(b) - lastActive(a))
  const rows = [...liveRows, ...recent.slice(0, 6)]
  const ticks = []
  const first = new Date(start); first.setMinutes(0, 0, 0)
  for (let t = first.getTime() + 3600e3; t < now - 1800e3; t += 3 * 3600e3) ticks.push(t)
  const grid = ticks.map(t => `<i style="left:${pos(t)}%"></i>`).join('') + `<i class="now" style="left:100%"></i>`
  $('#timeline').innerHTML = `
    <div class="tl-grid">${grid}</div>
    ${rows.map(row => `
      <div class="tl-row">
        <span class="lbl ${row.isLive ? 'live' : ''}" title="${esc(row.name)}">${esc(row.name)}</span>
        <div class="tl-track">
          ${row.active.map(([a, b]) => `<b style="left:${pos(a)}%;width:${Math.max(0.15, pos(b) - pos(a))}%" data-tip="${esc(row.name)} · working ${clock(a)}–${clock(b)} (${duration(b - a)})"></b>`).join('')}
          ${row.status.filter(seg => seg.status === 'waiting').map(seg => `<b class="wait" style="left:${pos(seg.start)}%;width:${Math.max(0.15, pos(seg.end) - pos(seg.start))}%" data-tip="${esc(row.name)} · waited ${duration(seg.end - seg.start)} for you from ${clock(seg.start)}"></b>`).join('')}
        </div>
        <span class="waited" title="Waited for you today">${row.waitedTodayMs ? duration(row.waitedTodayMs) : ''}</span>
      </div>`).join('') || '<div class="empty">No activity in the last 24 hours</div>'}
    <div class="tl-axis"><span></span><div class="tl-ticks">${ticks.map(t => `<span style="left:${pos(t)}%">${new Date(t).toLocaleTimeString([], { hour: 'numeric' })}</span>`).join('')}</div><span class="waited">waited today</span></div>`
  $('#timeline-note').textContent = `Working time comes from the transcripts. “Waiting for you” is recorded by the dashboard server, so it starts ${new Date(report.statusLogSince).toLocaleString()}.`
}

export function renderProjects() {
  const report = state.report
  if (!report) return
  $('#project-rows').innerHTML = report.projects.map(p => `
    <tr>
      <td><div class="name">${esc(p.project)}</div><div class="where"><code>${esc(p.cwd)}</code></div></td>
      <td class="num">${p.sessions}</td><td class="num">${p.prompts}</td><td class="num">${fmtTokens(p.tokens)}</td>
      <td class="num">${fmtCost(p.cost)}</td><td class="num">${p.commits}</td><td class="num">${p.files}</td>
      <td class="hide-sm"><div class="tags">${p.branches.slice(0, 2).map(b => `<span class="tag">${esc(b)}</span>`).join('')}${p.branches.length > 2 ? `<span class="tag">+${p.branches.length - 2}</span>` : ''}</div></td>
      <td class="hide-sm"><div class="tags">${p.topTools.slice(0, 3).map(t => `<span class="tag">${esc(t.tool)} ${t.count}</span>`).join('')}</div></td>
    </tr>`).join('') || '<tr><td colspan="9" class="empty">No activity in this range</td></tr>'
  document.querySelectorAll('[data-range-hint]').forEach(el => { el.textContent = state.range === 'today' ? 'today' : 'last 7 days' })
}

export function renderFeed() {
  const list = (state.live?.deliveries || []).slice().reverse()
  $('#feed').innerHTML = list.map(d => `
    <div><span>${d.isDelivered ? '✓' : '✕'}</span>
      <span class="msg"><b>${esc(d.name)}</b> · ${esc(d.via)} · “${esc(d.text)}”${d.reason ? ' — ' + esc(d.reason) : ''}</span>
      <span class="t">${ago(d.at)} ago</span></div>`).join('') || '<div class="empty" style="display:block">Nothing sent yet. Open a session in the list and message it from there.</div>'
}
