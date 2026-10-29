// The headline figures: live sessions, who waits for you, tokens, cost, context
// fill and plan usage.

import { $ } from './core/dom.js'
import { ago, esc, fmtCost, fmtTokens } from './core/format.js'
import { state } from './core/state.js'

// Time left in a usage window: "resets in 2h 14m", or a day and time when days away.
export function resetsIn(resetsAt) {
  const at = Date.parse(resetsAt)
  if (!at) return ''
  const minutes = Math.max(0, Math.round((at - Date.now()) / 60000))
  if (minutes === 0) return 'resets now'
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `resets in ${hours}h ${minutes % 60}m`
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h · ${new Date(at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}
export function renderTiles() {
  const live = state.live, report = state.report
  const sessions = live?.sessions || []
  const count = status => sessions.filter(s => s.status === status).length
  const waiting = sessions.filter(s => s.status === 'waiting')
  // The window's edges glow while anyone waits for you.
  document.documentElement.classList.toggle('needs-you', waiting.length > 0)
  const runningSubagentTotal = sessions.reduce((sum, s) => sum + (s.subagents || []).filter(a => a.isRunning).length, 0)
  const runningShellTotal = sessions.reduce((sum, s) => sum + (s.shells || []).length, 0)
  const longest = waiting.slice().sort((a, b) => a.updatedAt - b.updatedAt)[0]
  const fills = sessions.map(s => s.contextPercent)
  const hot = fills.filter(p => p >= 80).length
  const avgFill = fills.length ? Math.round(fills.reduce((a, b) => a + b, 0) / fills.length) : 0
  const totals = report?.totals
  const rangeTokens = totals ? totals.tokens.input + totals.tokens.output + totals.tokens.cacheRead + totals.tokens.cacheWrite5m + totals.tokens.cacheWrite1h : 0
  const cachePct = totals && rangeTokens ? Math.round((totals.tokens.cacheRead / rangeTokens) * 100) : 0
  const rangeName = state.range === 'today' ? 'today' : '7 days'
  const limits = (live?.rateLimits || []).filter(l => typeof l.percentUsed === 'number')
  const limitName = kind => ({ five_hour: '5-hour window', seven_day: '7-day window', seven_day_opus: '7-day Opus', spend_limit: 'Spend limit' }[kind] || String(kind).replace(/_/g, ' '))
  const limitHtml = limits.length
    ? limits.map(l => `<div class="limit"><div class="row"><span>${esc(limitName(l.kind))}</span><span>${Math.round(l.percentUsed)}%</span></div><div class="track"><b class="${l.percentUsed >= 80 ? 'hot' : ''}" style="width:${Math.min(100, l.percentUsed)}%"></b></div>${l.resetsAt ? `<div class="resets" title="Resets ${esc(new Date(l.resetsAt).toLocaleString())}">${resetsIn(l.resetsAt)}</div>` : ''}</div>`).join('')
    : '<div class="sub" style="white-space:normal">Shows once a connected session reports in</div>'
  $('#tiles').innerHTML = `
    <div class="tile"><div class="label">Live sessions</div><div class="value">${sessions.length}</div>
      <div class="sub">${count('busy')} working · ${count('idle') + count('shell')} idle${runningSubagentTotal ? ` · ${runningSubagentTotal} subagent${runningSubagentTotal > 1 ? 's' : ''}` : ''}${runningShellTotal ? ` · ${runningShellTotal} shell${runningShellTotal > 1 ? 's' : ''}` : ''}</div></div>
    <div class="tile ${waiting.length ? 'alert' : ''}"><div class="label">Waiting on you</div><div class="value">${waiting.length}</div>
      <div class="sub">${longest ? esc(longest.name) + ' · ' + ago(longest.updatedAt) : 'Nobody is waiting'}</div></div>
    <div class="tile"><div class="label">Tokens · ${rangeName}</div><div class="value">${fmtTokens(rangeTokens)}</div>
      <div class="sub">${cachePct}% read from cache</div></div>
    <div class="tile"><div class="label">Est. cost · ${rangeName}</div><div class="value">${fmtCost(totals?.cost)}</div>
      <div class="sub">Today ${fmtCost(totals?.today.cost)} · API list prices</div></div>
    <div class="tile"><div class="label">Avg context fill</div><div class="value">${avgFill}%</div>
      <div class="sub">${hot ? hot + ' session' + (hot > 1 ? 's' : '') + ' above 80%' : 'All below 80%'}</div></div>
    <div class="tile"><div class="label">Plan usage</div>${limitHtml}</div>`
}
