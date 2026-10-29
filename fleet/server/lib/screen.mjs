// A hidden session's screen for the page, rendered from `claude logs`.

import { claudeBinary } from './hidden-sessions.mjs'
import { live } from './state.mjs'
import { run, stripAnsi } from './utils.mjs'

// What a hidden session's terminal shows, from `claude logs <id>`: the raw
// output is replayed on a small grid so the page can draw the screen as text.
function renderScreen(raw, columns = 200, rows = 50) {
  const blank = () => ({ character: ' ', fg: '', bold: false })
  let grid = Array.from({ length: rows }, () => Array.from({ length: columns }, blank))
  let row = 0, column = 0, foreground = '', bold = false
  const clamp = () => { row = Math.max(0, Math.min(rows - 1, row)); column = Math.max(0, Math.min(columns - 1, column)) }
  const newline = () => { row++; if (row >= rows) { grid.shift(); grid.push(Array.from({ length: columns }, blank)); row = rows - 1 } }
  const text = String(raw)
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '\x1b') {
      const next = text[index + 1]
      if (next === '[') {
        let end = index + 2
        while (end < text.length && !/[@-~]/.test(text[end])) end++
        const params = text.slice(index + 2, end).replace(/^\?/, '')
        const final = text[end]
        const numbers = params.split(';').map(part => Number(part) || 0)
        const first = numbers[0] || 0
        if (final === 'm') {
          for (let paramIndex = 0; paramIndex < numbers.length; paramIndex++) {
            const code = params ? numbers[paramIndex] : 0
            if (code === 0) { foreground = ''; bold = false }
            else if (code === 1) bold = true
            else if (code === 22) bold = false
            else if (code === 39) foreground = ''
            else if (code === 38 && numbers[paramIndex + 1] === 2) { foreground = `rgb(${numbers[paramIndex + 2]},${numbers[paramIndex + 3]},${numbers[paramIndex + 4]})`; paramIndex += 4 }
            else if (code === 38 && numbers[paramIndex + 1] === 5) { paramIndex += 2 }
            else if (code === 48) { paramIndex += numbers[paramIndex + 1] === 2 ? 4 : 2 }
            else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) foreground = ['#000', '#c33', '#3a3', '#c90', '#36c', '#c3c', '#3cc', '#ccc'][(code % 10)]
          }
        } else if (final === 'H' || final === 'f') { row = (numbers[0] || 1) - 1; column = (numbers[1] || 1) - 1; clamp() }
        else if (final === 'A') { row -= first || 1; clamp() }
        else if (final === 'B') { row += first || 1; clamp() }
        else if (final === 'C') { column += first || 1; clamp() }
        else if (final === 'D') { column -= first || 1; clamp() }
        else if (final === 'G') { column = (first || 1) - 1; clamp() }
        else if (final === 'd') { row = (first || 1) - 1; clamp() }
        else if (final === 'J') {
          if (first === 2 || first === 3) grid = Array.from({ length: rows }, () => Array.from({ length: columns }, blank))
          else if (first === 0) { for (let columnIndex = column; columnIndex < columns; columnIndex++) grid[row][columnIndex] = blank(); for (let rowIndex = row + 1; rowIndex < rows; rowIndex++) grid[rowIndex] = Array.from({ length: columns }, blank) }
        } else if (final === 'K') {
          const [from, to] = first === 1 ? [0, column + 1] : first === 2 ? [0, columns] : [column, columns]
          for (let columnIndex = from; columnIndex < to; columnIndex++) grid[row][columnIndex] = blank()
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
    if (character === '\r') { column = 0; continue }
    if (character === '\n') { newline(); continue }
    if (character === '\b') { column = Math.max(0, column - 1); continue }
    if (character === '\t') { column = Math.min(columns - 1, (Math.floor(column / 8) + 1) * 8); continue }
    if (character < ' ' || character === '\x7f') continue
    if (column >= columns) { column = 0; newline() }
    grid[row][column] = { character, fg: foreground, bold }
    column++
  }
  // Rows as runs of one style, trailing blanks dropped.
  const lines = grid.map(cells => {
    let last = cells.length - 1
    while (last >= 0 && cells[last].character === ' ') last--
    const runs = []
    for (let columnIndex = 0; columnIndex <= last; columnIndex++) {
      const cell = cells[columnIndex], currentRun = runs[runs.length - 1]
      if (currentRun && currentRun.fg === cell.fg && currentRun.bold === cell.bold) currentRun.text += cell.character
      else runs.push({ text: cell.character, fg: cell.fg, bold: cell.bold })
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
