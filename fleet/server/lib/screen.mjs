import { claudeBinary } from './hidden-sessions.mjs'
import { live } from './state.mjs'
import { run, stripAnsi } from './utils.mjs'

// What a hidden session's terminal shows, from `claude logs <id>`: the raw
// output is replayed on a small grid so the page can draw the screen as text.
function renderScreen(raw, cols = 200, rows = 50) {
  const blank = () => ({ ch: ' ', fg: '', bold: false })
  let grid = Array.from({ length: rows }, () => Array.from({ length: cols }, blank))
  let row = 0, col = 0, fg = '', bold = false
  const clamp = () => { row = Math.max(0, Math.min(rows - 1, row)); col = Math.max(0, Math.min(cols - 1, col)) }
  const newline = () => { row++; if (row >= rows) { grid.shift(); grid.push(Array.from({ length: cols }, blank)); row = rows - 1 } }
  const text = String(raw)
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]
    if (ch === '\x1b') {
      const next = text[index + 1]
      if (next === '[') {
        let end = index + 2
        while (end < text.length && !/[@-~]/.test(text[end])) end++
        const params = text.slice(index + 2, end).replace(/^\?/, '')
        const final = text[end]
        const numbers = params.split(';').map(part => Number(part) || 0)
        const first = numbers[0] || 0
        if (final === 'm') {
          for (let at = 0; at < numbers.length; at++) {
            const code = params ? numbers[at] : 0
            if (code === 0) { fg = ''; bold = false }
            else if (code === 1) bold = true
            else if (code === 22) bold = false
            else if (code === 39) fg = ''
            else if (code === 38 && numbers[at + 1] === 2) { fg = `rgb(${numbers[at + 2]},${numbers[at + 3]},${numbers[at + 4]})`; at += 4 }
            else if (code === 38 && numbers[at + 1] === 5) { at += 2 }
            else if (code === 48) { at += numbers[at + 1] === 2 ? 4 : 2 }
            else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = ['#000', '#c33', '#3a3', '#c90', '#36c', '#c3c', '#3cc', '#ccc'][(code % 10)]
          }
        } else if (final === 'H' || final === 'f') { row = (numbers[0] || 1) - 1; col = (numbers[1] || 1) - 1; clamp() }
        else if (final === 'A') { row -= first || 1; clamp() }
        else if (final === 'B') { row += first || 1; clamp() }
        else if (final === 'C') { col += first || 1; clamp() }
        else if (final === 'D') { col -= first || 1; clamp() }
        else if (final === 'G') { col = (first || 1) - 1; clamp() }
        else if (final === 'd') { row = (first || 1) - 1; clamp() }
        else if (final === 'J') {
          if (first === 2 || first === 3) grid = Array.from({ length: rows }, () => Array.from({ length: cols }, blank))
          else if (first === 0) { for (let c = col; c < cols; c++) grid[row][c] = blank(); for (let r = row + 1; r < rows; r++) grid[r] = Array.from({ length: cols }, blank) }
        } else if (final === 'K') {
          const [from, to] = first === 1 ? [0, col + 1] : first === 2 ? [0, cols] : [col, cols]
          for (let c = from; c < to; c++) grid[row][c] = blank()
        }
        index = end
      } else if (next === ']') {
        // An OSC string ends at BEL or ESC \.
        let end = index + 2
        while (end < text.length && text[end] !== '\x07' && !(text[end] === '\x1b' && text[end + 1] === '\\')) end++
        index = text[end] === '\x07' ? end : end + 1
      } else index++
      continue
    }
    if (ch === '\r') { col = 0; continue }
    if (ch === '\n') { newline(); continue }
    if (ch === '\b') { col = Math.max(0, col - 1); continue }
    if (ch === '\t') { col = Math.min(cols - 1, (Math.floor(col / 8) + 1) * 8); continue }
    if (ch < ' ' || ch === '\x7f') continue
    if (col >= cols) { col = 0; newline() }
    grid[row][col] = { ch, fg, bold }
    col++
  }
  // Rows as runs of one style, trailing blanks dropped.
  const lines = grid.map(cells => {
    let last = cells.length - 1
    while (last >= 0 && cells[last].ch === ' ') last--
    const runs = []
    for (let c = 0; c <= last; c++) {
      const cell = cells[c], run = runs[runs.length - 1]
      if (run && run.fg === cell.fg && run.bold === cell.bold) run.text += cell.ch
      else runs.push({ text: cell.ch, fg: cell.fg, bold: cell.bold })
    }
    return runs
  })
  while (lines.length && !lines[lines.length - 1].length) lines.pop()
  return lines
}
export async function hiddenScreen(sessionId) {
  const session = live.get(sessionId)
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  if (!session.hidden) return { ok: false, reason: 'Only a hidden session shows its screen here.' }
  const result = await run(claudeBinary(), ['logs', session.jobId], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 })
  if (result.code !== 0) return { ok: false, reason: stripAnsi(result.stderr || result.stdout).trim().split('\n')[0] || 'Its screen could not be read.' }
  return { ok: true, lines: renderScreen(result.stdout), at: Date.now() }
}
