// Claude's replies as Markdown: fenced code (with a Copy button), tables,
// headings, lists (nested, numbered, tasks), quotes, rules and paragraphs; and
// inside them inline code, links, bold, italic and strikethrough. Text is
// escaped before any markup is added, so nothing in a reply turns into markup it
// did not ask for, and a link opens only http, https or mailto.

import { escapeHtml } from './format.js'

const SAFE_URL = /^(https?:\/\/|mailto:)/i
const FENCE = /^\s*(`{3,}|~{3,})/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)(?:\s+#+)?\s*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?/
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/

// Inline formatting of one piece of text. Code spans and links are set aside
// first, so a * or _ inside them is never read as emphasis.
function inline(source) {
  const keep = []
  const hold = html => `\u0000${keep.push(html) - 1}\u0000`
  // The placeholder character itself never comes from a reply.
  let text = escapeHtml(String(source).replace(/\u0000/g, ''))
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code data-copy-inline title="Click to copy">${code}</code>`))
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, url) => (SAFE_URL.test(url.replace(/&amp;/g, '&')) ? hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`) : match))
    // A bare URL ends at a space, a closing bracket or trailing punctuation, or an escaped quote or angle bracket.
    .replace(/(^|[\s(]|&quot;|&#39;)((?:https?:\/\/|mailto:)(?:(?!&quot;|&#39;|&lt;|&gt;)[^\s\u0000])*?)(?=[.,:;!?)\]]*(?:\s|$|&quot;|&#39;|&lt;|&gt;))/g, (_, before, url) => before + hold(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`))
  // Bold is ** only: __name__ in a reply is far more often Python than emphasis.
  text = text
    .replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/~~(?=\S)([^~\n]+?)~~/g, '<del>$1</del>')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]+?)\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^\w_])_(?=\S)([^_\n]+?)_(?!\w)/g, '$1<em>$2</em>')
  return text.replace(/\u0000(\d+)\u0000/g, (_, index) => keep[Number(index)])
}

// A code block carries a Copy button: the chat redraws every 2 seconds, which
// makes dragging over it hard.
const codeBlock = code => `<div class="code-block"><button type="button" class="code-copy" data-copy-code>Copy</button><pre><code>${escapeHtml(code)}</code></pre></div>`

// A table row's cells; a \| inside a cell is a literal bar.
function cellsOf(line) {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'))
}
const isTableRow = line => line.includes('|') && line.trim().length > 1
const isDivider = line => isTableRow(line) && cellsOf(line).every(cell => /^:?-+:?$/.test(cell))

function table(lines) {
  const header = cellsOf(lines[0])
  const aligns = cellsOf(lines[1]).map(cell => (cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : ''))
  const cell = (tag, text, column) => `<${tag}${aligns[column] ? ` style="text-align:${aligns[column]}"` : ''}>${inline(text || '')}</${tag}>`
  const body = lines.slice(2).map(line => {
    const cells = cellsOf(line)
    return `<tr>${header.map((_, column) => cell('td', cells[column], column)).join('')}</tr>`
  })
  return `<div class="md-table"><table><thead><tr>${header.map((text, column) => cell('th', text, column)).join('')}</tr></thead><tbody>${body.join('')}</tbody></table></div>`
}

// Consecutive list items, nested by indent. A line indented under an item
// without a marker continues that item.
function list(lines) {
  let html = ''
  const open = [] // { indent, tag }
  for (const line of lines) {
    const item = line.match(LIST_ITEM)
    if (!item) {
      html = html.replace(/<\/li>$/, `<br>${inline(line.trim())}</li>`)
      continue
    }
    const indent = item[1].replace(/\t/g, '    ').length
    const tag = /\d/.test(item[2]) ? 'ol' : 'ul'
    while (open.length && indent < open.at(-1).indent) {
      const closing = open.pop()
      html += `</${closing.tag}>` + (closing.isNested ? '</li>' : '')
    }
    if (!open.length || indent > open.at(-1).indent) {
      const start = tag === 'ol' && parseInt(item[2], 10) !== 1 ? ` start="${parseInt(item[2], 10)}"` : ''
      if (open.length) html = html.replace(/<\/li>$/, '')
      html += `<${tag}${start}>`
      open.push({ indent, tag, isNested: open.length > 0 })
    }
    const task = item[3].match(/^\[([ xX])\]\s+(.*)$/)
    const content = task ? `<span class="md-task">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2])}` : inline(item[3])
    html += `<li>${content}</li>`
  }
  while (open.length) {
    const closing = open.pop()
    html += `</${closing.tag}>` + (closing.isNested ? '</li>' : '')
  }
  return html
}

const startsBlock = (line, next) =>
  FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || LIST_ITEM.test(line) || (isTableRow(line) && next !== undefined && isDivider(next))

export function markdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n')
  const html = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const fence = line.match(FENCE)
    if (fence) {
      const body = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) body.push(lines[index++])
      index++
      html.push(codeBlock(body.join('\n')))
      continue
    }
    if (isTableRow(line) && index + 1 < lines.length && isDivider(lines[index + 1])) {
      const rows = [line, lines[index + 1]]
      index += 2
      while (index < lines.length && isTableRow(lines[index]) && lines[index].trim()) rows.push(lines[index++])
      html.push(table(rows))
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      html.push(`<div class="md-h md-h${heading[1].length}">${inline(heading[2])}</div>`)
      index++
      continue
    }
    if (RULE.test(line)) { html.push('<hr>'); index++; continue }
    if (QUOTE.test(line)) {
      const quoted = []
      while (index < lines.length && QUOTE.test(lines[index])) quoted.push(lines[index++].replace(QUOTE, ''))
      html.push(`<blockquote>${markdown(quoted.join('\n'))}</blockquote>`)
      continue
    }
    if (LIST_ITEM.test(line)) {
      const items = []
      while (index < lines.length && lines[index].trim() && (LIST_ITEM.test(lines[index]) || /^\s+\S/.test(lines[index])) && !FENCE.test(lines[index])) items.push(lines[index++])
      html.push(list(items))
      continue
    }
    const paragraph = []
    while (index < lines.length && lines[index].trim() && !(paragraph.length && startsBlock(lines[index], lines[index + 1]))) paragraph.push(lines[index++])
    html.push(`<p>${paragraph.map(text => inline(text.trim())).join('<br>')}</p>`)
  }
  return html.join('')
}
