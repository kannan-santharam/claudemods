import { $, css } from '../core/dom.js'
import { fmtCost, fmtTokens, shortModel } from '../core/format.js'
import { MODEL_SLOTS, modelColor } from '../core/models.js'
import { state } from '../core/state.js'

// ---------------------------------------------------------------- charts --
function baseOptions(horizontal) {
  const grid = css('--grid'), muted = css('--text-muted'), text = css('--text-secondary')
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    indexAxis: horizontal ? 'y' : 'x',
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: css('--text-primary'), titleColor: css('--bg'), bodyColor: css('--bg'), footerColor: css('--bg'), padding: 9, cornerRadius: 7, boxPadding: 4 },
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
  const color = css('--series-1')
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
  const known = MODEL_SLOTS.filter(m => report.models.includes(m))
  const other = report.models.filter(m => !MODEL_SLOTS.includes(m))
  const series = [...known.map(m => ({ label: shortModel(m), color: modelColor(m), keys: [m] })), ...(other.length ? [{ label: 'Other', color: css('--series-other'), keys: other }] : [])]
  const fmt = measure === 'cost' ? fmtCost : fmtTokens
  const options = baseOptions(false)
  options.scales.x.stacked = true
  options.scales.y.stacked = true
  options.scales.y.ticks.callback = value => fmt(value)
  options.plugins.legend = { display: series.length > 1, position: 'top', align: 'end', labels: { color: css('--text-secondary'), usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 8, boxHeight: 8, padding: 14, font: { size: 12 } } }
  options.plugins.tooltip.callbacks = {
    label: item => ` ${item.dataset.label}: ${fmt(item.raw)}`,
    footer: items => 'Total ' + fmt(items.reduce((sum, item) => sum + item.raw, 0)),
  }
  options.interaction = { mode: 'index', intersect: false }
  upsertChart('chart-days', {
    type: 'bar',
    data: {
      labels: report.days.map(d => new Date(d.day + 'T12:00').toLocaleDateString([], { weekday: 'short', day: 'numeric' })),
      datasets: series.map(s => ({
        label: s.label,
        data: report.days.map(d => s.keys.reduce((sum, key) => sum + ((d.byModel[key] || {})[measure] || 0), 0)),
        backgroundColor: s.color, hoverBackgroundColor: s.color,
        borderColor: css('--surface-1'), borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 3, maxBarThickness: 46,
      })),
    },
    options,
  })
  $('#usage-title').textContent = measure === 'cost' ? 'Estimated cost per day, by model' : 'Tokens per day, by model'

  const projects = report.projects.slice(0, 8)
  horizontalBars('chart-projects', projects.map(p => p.project), projects.map(p => p.cost), fmtCost)
  const sessions = report.sessions.slice(0, 8)
  horizontalBars('chart-sessions', sessions.map(s => (s.isLive ? '● ' : '') + s.name), sessions.map(s => s.tokens), fmtTokens)
  const tools = report.tools.slice(0, 10)
  horizontalBars('chart-tools', tools.map(t => t.tool), tools.map(t => t.count), v => Math.round(v).toLocaleString())
}
