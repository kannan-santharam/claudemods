// The report range (Today or 7 days) and the cost or tokens measure.

import { state } from '../core/state.js'
import { refreshReport } from '../refresh.js'
import { renderCharts } from './charts.js'

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
