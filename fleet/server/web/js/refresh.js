import { api } from './core/api.js'
import { $, toast } from './core/dom.js'
import { state } from './core/state.js'
import { setConnection } from './dialogs/connection.js'
import { office } from './office.js'
import { renderCharts } from './reports/charts.js'
import { renderContextBars, renderFeed, renderProjects, renderTimeline } from './reports/panels.js'
import { drawOfficeMini } from './sessions/layout.js'
import { renderLive } from './sessions/live.js'
import { renderTiles } from './tiles.js'

export function renderAll() {
  renderTiles(); renderLive(); renderContextBars(); renderFeed(); renderTimeline(); renderProjects(); renderCharts()
}

// ---------------------------------------------------------------- polling --
export async function refreshLive() {
  try {
    state.live = await api('/api/live')
    state.lastLiveOk = Date.now()
    const ids = new Set(state.live.sessions.map(s => s.sessionId))
    for (const id of [...state.selected]) if (!ids.has(id)) state.selected.delete(id)
    office.sync(state.live)
    renderTiles(); renderContextBars(); renderFeed()
    drawOfficeMini()
    // A native select closes when redrawn: hold the table while one has focus.
    if (!(document.activeElement && document.activeElement.tagName === 'SELECT' && $('#view-sessions').contains(document.activeElement))) renderLive()
  } catch (error) {
    $('#updated').textContent = error.message
    // A fetch that never reached the server throws a TypeError.
    if (error.code === 'signin') setConnection('signin')
    else if (error instanceof TypeError) setConnection('down')
  }
}
export async function refreshReport() {
  try {
    state.report = await api('/api/report?range=' + state.range)
    renderTiles(); renderTimeline(); renderProjects(); renderCharts()
  } catch (error) {
    toast(error.message)
  }
}
