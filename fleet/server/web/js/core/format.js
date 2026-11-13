// Formatting for display: HTML escaping, tokens, money, times and durations,
// and model names. Markdown is markdown.js.

// Where a session works: the repository its edits and commits go to when that is
// not the folder it was started in (the server's `work`), else that folder.
export function placeOf(session) {
  const work = session.work
  if (!work) return { folder: session.folder, branch: session.branch || '', path: session.cwd || session.folder, isElsewhere: false, note: session.cwd || session.folder }
  return { folder: work.folder, branch: work.branch, path: work.path, isElsewhere: true, note: `Working in ${work.path}${work.branch ? ' on ' + work.branch : ''}. Started in ${session.cwd || session.folder}.` }
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
export const formatTokens = tokens => tokens >= 1e9 ? (tokens / 1e9).toFixed(2) + 'B' : tokens >= 1e6 ? (tokens / 1e6).toFixed(1) + 'M' : tokens >= 1e3 ? Math.round(tokens / 1e3) + 'k' : String(Math.round(tokens || 0))
export const formatCost = dollars => dollars == null ? '—' : dollars >= 100 ? '$' + Math.round(dollars).toLocaleString() : '$' + dollars.toFixed(2)
// A fill bar's colour class by how full it is: blue below half, then yellow, red, and dark red from 85%.
export const fillLevel = percent => percent >= 85 ? 'max' : percent >= 70 ? 'hot' : percent >= 50 ? 'mid' : ''
export const clock = time => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
export function timeAgo(time) {
  if (!time) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 60) return seconds + 's'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return minutes + 'm'
  const hours = Math.round(minutes / 60)
  return hours < 48 ? hours + 'h' : Math.round(hours / 24) + 'd'
}
export function duration(milliseconds) {
  const minutes = Math.max(1, Math.round(milliseconds / 60000))
  return minutes < 60 ? minutes + 'm' : Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm'
}
export function shortModel(model) {
  return String(model || '—').replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-(\d)$/, ' $1')
}

// The report ranges as the tiles and panel hints name them.
const RANGE_NAMES = { today: 'today', '7d': '7 days', '30d': '30 days' }
export const rangeName = range => RANGE_NAMES[range] || RANGE_NAMES.today
export const rangeHint = range => range === 'today' ? 'today' : 'last ' + rangeName(range)
