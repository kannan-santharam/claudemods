// Formatting for display: HTML escaping, tokens, money, times and durations,
// model names, and a small Markdown reader for Claude's replies.

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
export const formatTokens = tokens => tokens >= 1e9 ? (tokens / 1e9).toFixed(2) + 'B' : tokens >= 1e6 ? (tokens / 1e6).toFixed(1) + 'M' : tokens >= 1e3 ? Math.round(tokens / 1e3) + 'k' : String(Math.round(tokens || 0))
export const formatCost = dollars => dollars == null ? '—' : dollars >= 100 ? '$' + Math.round(dollars).toLocaleString() : '$' + dollars.toFixed(2)
// A fill bar's colour class by how full it is: blue below half, then yellow, red, and dark red from 85%.
export const fillLevel = percent => percent >= 85 ? 'max' : percent >= 70 ? 'hot' : percent >= 50 ? 'mid' : ''
export const clock = time => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
// A small Markdown reader for replies: the text is escaped first, so only the
// tags written here can appear. Code fences, inline code, bold, italics,
// headings, bullets and http(s) links.
function inlineMarkdown(text) {
  return text
    .replace(/`([^`\n]+)`/g, '<code data-copy-inline title="Click to copy">$1</code>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}
export function markdown(source) {
  const parts = escapeHtml(source).split(/^```[^\n]*\n?/m)
  return parts.map((part, index) => {
    // A code block carries a Copy button: the chat redraws every 2 seconds, which makes dragging over it hard.
    if (index % 2 === 1) return `<div class="code-block"><button type="button" class="code-copy" data-copy-code>Copy</button><pre><code>${part.replace(/\n$/, '')}</code></pre></div>`
    return part.split('\n').map(line => {
      // Inline code is set aside first so a * inside it is never read as emphasis.
      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading) return `<span class="md-h">${inlineMarkdown(heading[2])}</span>`
      const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/)
      if (bullet) return `${bullet[1]}• ${inlineMarkdown(bullet[2])}`
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return '<hr>'
      return inlineMarkdown(line)
    }).join('\n')
  }).join('')
}
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
