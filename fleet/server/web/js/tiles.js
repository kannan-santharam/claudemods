// The headline figures: live sessions, who waits for you, tokens, cost, context
// fill and plan usage.

import { $ } from './core/dom.js'
import { escapeHtml, fillLevel, formatCost, formatTokens, rangeName, timeAgo } from './core/format.js'
import { state } from './core/state.js'

// Time left in a usage window: "resets in 2h 14m", or a day and time when days away.
export function resetsIn(resetsAt) {
  const resetTime = Date.parse(resetsAt)
  if (!resetTime) return ''
  const minutes = Math.max(0, Math.round((resetTime - Date.now()) / 60000))
  if (minutes === 0) return 'resets now'
  if (minutes < 60) return `resets in ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `resets in ${hours}h ${minutes % 60}m`
  return `resets in ${Math.floor(hours / 24)}d ${hours % 24}h · ${new Date(resetTime).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
}
export function renderTiles() {
  const live = state.live, report = state.report
  const sessions = live?.sessions || []
  const count = status => sessions.filter(session => session.status === status).length
  const waiting = sessions.filter(session => session.status === 'waiting')
  // The window's edges glow while anyone waits for you.
  document.documentElement.classList.toggle('needs-you', waiting.length > 0)
  const runningSubagentTotal = sessions.reduce((sum, session) => sum + (session.subagents || []).filter(agent => agent.isRunning).length, 0)
  const runningShellTotal = sessions.reduce((sum, session) => sum + (session.shells || []).length, 0)
  const longest = waiting.slice().sort((first, second) => first.updatedAt - second.updatedAt)[0]
  const fills = sessions.map(session => session.contextPercent)
  const hot = fills.filter(percent => percent >= 70).length
  const averageFill = fills.length ? Math.round(fills.reduce((total, fill) => total + fill, 0) / fills.length) : 0
  const totals = report?.totals
  const rangeTokens = totals ? totals.tokens.input + totals.tokens.output + totals.tokens.cacheRead + totals.tokens.cacheWrite5m + totals.tokens.cacheWrite1h : 0
  const cachePercent = totals && rangeTokens ? Math.round((totals.tokens.cacheRead / rangeTokens) * 100) : 0
  const limits = (live?.rateLimits || []).filter(limit => typeof limit.percentUsed === 'number')
  const limitName = kind => ({ five_hour: '5-hour window', seven_day: '7-day window', seven_day_opus: '7-day Opus', spend_limit: 'Spend limit' }[kind] || String(kind).replace(/_/g, ' '))
  const limitHtml = limits.length
    ? limits.map(limit => `<div class="limit"><div class="row"><span>${escapeHtml(limitName(limit.kind))}</span><span>${Math.round(limit.percentUsed)}%</span></div><div class="track"><b class="${fillLevel(limit.percentUsed)}" style="width:${Math.min(100, limit.percentUsed)}%"></b></div>${limit.resetsAt ? `<div class="resets" title="Resets ${escapeHtml(new Date(limit.resetsAt).toLocaleString())}">${resetsIn(limit.resetsAt)}</div>` : ''}</div>`).join('')
    : '<div class="sub" style="white-space:normal">Shows once a connected session reports in</div>'
  $('#tiles').innerHTML = `
    <div class="tile"><div class="label">Live sessions</div><div class="value">${sessions.length}</div>
      <div class="sub">${count('busy')} working · ${count('idle') + count('shell')} idle${runningSubagentTotal ? ` · ${runningSubagentTotal} subagent${runningSubagentTotal > 1 ? 's' : ''}` : ''}${runningShellTotal ? ` · ${runningShellTotal} shell${runningShellTotal > 1 ? 's' : ''}` : ''}</div></div>
    <div class="tile ${waiting.length ? 'alert' : ''}"><div class="label">Waiting on you</div><div class="value">${waiting.length}</div>
      <div class="sub">${longest ? escapeHtml(longest.name) + ' · ' + timeAgo(longest.updatedAt) : 'Nobody is waiting'}</div></div>
    <div class="tile"><div class="label">Tokens · ${rangeName(state.range)}</div><div class="value">${formatTokens(rangeTokens)}</div>
      <div class="sub">${cachePercent}% read from cache</div></div>
    <div class="tile"><div class="label">Est. cost · ${rangeName(state.range)}</div><div class="value">${formatCost(totals?.cost)}</div>
      <div class="sub">Today ${formatCost(totals?.today.cost)} · API list prices</div></div>
    <div class="tile"><div class="label">Avg context fill</div><div class="value">${averageFill}%</div>
      <div class="sub">${hot ? hot + ' session' + (hot > 1 ? 's' : '') + ' above 70%' : 'All below 70%'}</div></div>
    <div class="tile"><div class="label">Plan usage</div>${limitHtml}</div>`
}
