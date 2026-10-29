import { state } from '../core/state.js'
import { refreshReport } from '../refresh.js'
import { renderCharts } from './charts.js'

// ---------------------------------------------------------------- controls --

export function initReportControls() {
  document.querySelectorAll('[data-range]').forEach(button => button.addEventListener('click', () => {
    state.range = button.dataset.range
    document.querySelectorAll('[data-range]').forEach(b => b.setAttribute('aria-pressed', String(b === button)))
    refreshReport()
  }))
  document.querySelectorAll('[data-measure]').forEach(button => button.addEventListener('click', () => {
    state.measure = button.dataset.measure
    document.querySelectorAll('[data-measure]').forEach(b => b.setAttribute('aria-pressed', String(b === button)))
    renderCharts()
  }))
}
