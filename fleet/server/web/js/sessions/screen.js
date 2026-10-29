import { api } from '../core/api.js'
import { ago, esc } from '../core/format.js'
import { sessionById, state } from '../core/state.js'

// A hidden session's terminal screen, read every 2 seconds while it is shown.
export function screenHtml(s) {
  const screen = state.screens[s.sessionId]
  if (!screen) return '<div class="screen-note">Reading its screen…</div>'
  if (screen.error) return `<div class="screen-note">${esc(screen.error)}</div>`
  const lines = screen.lines.map(runs => runs.map(run => `<span${run.fg || run.bold ? ` style="${run.fg ? 'color:' + esc(run.fg) + ';' : ''}${run.bold ? 'font-weight:700' : ''}"` : ''}>${esc(run.text)}</span>`).join('')).join('\n')
  return `<pre class="screen">${lines}</pre><div class="screen-note">What its terminal shows, read ${esc(ago(screen.at))} ago. To type into it, use Open in terminal.</div>`
}
let isReadingScreens = false
export async function refreshScreens() {
  if (isReadingScreens) return
  isReadingScreens = true
  try {
    for (const sessionId of state.showScreen) {
      if (!state.open.has(sessionId) || !sessionById(sessionId)?.hidden) continue
      try {
        const result = await api('/api/screen?sessionId=' + encodeURIComponent(sessionId))
        state.screens[sessionId] = result.ok ? { lines: result.lines, at: result.at } : { error: result.reason }
      } catch (error) { state.screens[sessionId] = { error: error.message } }
    }
  } finally { isReadingScreens = false }
}
