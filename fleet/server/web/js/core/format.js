// ---------------------------------------------------------------- helpers --
export const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
export const fmtTokens = n => n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(Math.round(n || 0))
export const fmtCost = n => n == null ? '—' : n >= 100 ? '$' + Math.round(n).toLocaleString() : '$' + n.toFixed(2)
export const clock = t => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
// A small Markdown reader for replies: the text is escaped first, so only the
// tags written here can appear. Code fences, inline code, bold, italics,
// headings, bullets and http(s) links.
function inlineMarkdown(text) {
  return text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*\n]*?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
}
export function markdown(source) {
  const parts = esc(source).split(/^```[^\n]*\n?/m)
  return parts.map((part, index) => {
    if (index % 2 === 1) return `<pre><code>${part.replace(/\n$/, '')}</code></pre>`
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
export function ago(time) {
  if (!time) return '—'
  const s = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (s < 60) return s + 's'
  const m = Math.round(s / 60)
  if (m < 60) return m + 'm'
  const h = Math.round(m / 60)
  return h < 48 ? h + 'h' : Math.round(h / 24) + 'd'
}
export function duration(ms) {
  const m = Math.max(1, Math.round(ms / 60000))
  return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'
}
export function shortModel(model) {
  return String(model || '—').replace(/^claude-/, '').replace(/-(\d)-(\d)$/, ' $1.$2').replace(/-(\d)$/, ' $1')
}
