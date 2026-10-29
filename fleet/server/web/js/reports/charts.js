// The Reports tab's charts, drawn with Chart.js in the theme's colours.

import { $, cssVariable } from '../core/dom.js'
import { formatCost, formatTokens, shortModel } from '../core/format.js'
import { MODEL_SLOTS, modelColor } from '../core/models.js'
import { state } from '../core/state.js'

function baseOptions(horizontal) {
  const grid = cssVariable('--grid'), muted = cssVariable('--text-muted'), text = cssVariable('--text-secondary')
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: cssVariable('--text-primary'), titleColor: cssVariable('--bg'), bodyColor: cssVariable('--bg'), footerColor: cssVariable('--bg'), padding: 9, cornerRadius: 7, boxPadding: 4 },
    },
    scales: {
      x: { grid: { color: horizontal ? grid : 'transparent', drawTicks: false }, border: { display: false }, ticks: { color: muted, padding: 6, font: { size: 11 } } },
      y: { grid: { color: horizontal ? 'transparent' : grid, drawTicks: false }, border: { display: false }, ticks: { color: horizontal ? text : muted, padding: 8, font: { size: 11.5 } } },
    },
  }
}
function upsertChart(id, config) {
  const canvas = document.getElementById(id)
  if (!window.Chart) {
    if (canvas) canvas.parentElement.innerHTML = '<div class="empty">Charts need Chart.js from cdn.jsdelivr.net, which did not load.</div>'
    return
  }
  state.charts[id]?.destroy()
  state.charts[id] = new Chart(canvas, config)
}
function horizontalBars(id, labels, values, format) {
  const color = cssVariable('--series-1')
  const options = baseOptions(true)
  options.scales.x.ticks.callback = value => format(value)
  options.plugins.tooltip.callbacks = { label: item => ' ' + format(item.raw) }
  options.plugins.tooltip.displayColors = false
  upsertChart(id, {
    type: 'bar',
    data: { labels, datasets: [{ data: values, backgroundColor: color, hoverBackgroundColor: color, borderRadius: 4, borderSkipped: 'start', barThickness: 12 }] },
    options,
  })
}
export function renderCharts() {
  const report = state.report
  if (!report) return
  const measure = state.measure
  const known = MODEL_SLOTS.filter(model => report.models.includes(model))
  const other = report.models.filter(model => !MODEL_SLOTS.includes(model))
  const series = [...known.map(model => ({ label: shortModel(model), color: modelColor(model), keys: [model] })), ...(other.length ? [{ label: 'Other', color: cssVariable('--series-other'), keys: other }] : [])]
  const formatValue = measure === 'cost' ? formatCost : formatTokens
  const options = baseOptions(false)
  options.scales.x.stacked = true
  options.scales.y.stacked = true
  options.scales.y.ticks.callback = value => formatValue(value)
  options.plugins.legend = { display: series.length > 1, position: 'top', align: 'end', labels: { color: cssVariable('--text-secondary'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 12 } } }
  options.plugins.tooltip.callbacks = {
    label: item => ` ${item.dataset.label}: ${formatValue(item.raw)}`,
    footer: items => 'Total ' + formatValue(items.reduce((sum, item) => sum + item.raw, 0)),
  }
  options.interaction = { mode: 'index', intersect: false }
  upsertChart('chart-days', {
    type: 'bar',
    data: {
      labels: report.days.map(day => new Date(day.day + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' })),
      datasets: series.map(seriesEntry => ({
        label: seriesEntry.label,
        data: report.days.map(day => seriesEntry.keys.reduce((sum, key) => sum + ((day.byModel[key] || {})[measure] || 0), 0)),
        backgroundColor: seriesEntry.color, hoverBackgroundColor: seriesEntry.color,
        borderColor: cssVariable('--surface-1'), borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 3, maxBarThickness: 46,
      })),
    },
    options,
  })
  $('#usage-title').textContent = measure === 'cost' ? 'Estimated cost per day, by model' : 'Tokens per day, by model'

  const projects = report.projects.slice(0, 8)
  horizontalBars('chart-projects', projects.map(project => project.project), projects.map(project => project.cost), formatCost)
  const sessions = report.sessions.slice(0, 8)
  horizontalBars('chart-sessions', sessions.map(session => (session.isLive ? '● ' : '') + session.name), sessions.map(session => session.tokens), formatTokens)
  const tools = report.tools.slice(0, 10)
  horizontalBars('chart-tools', tools.map(usage => usage.tool), tools.map(usage => usage.count), value => Math.round(value).toLocaleString())
}
