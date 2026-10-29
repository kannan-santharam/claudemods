// The Sessions, Office and Reports tabs.

import { $ } from './core/dom.js'
import { remember } from './core/storage.js'
import { office } from './office/index.js'
import { renderCharts } from './reports/charts.js'
import { renderContextBars, renderTimeline } from './reports/panels.js'
import { drawOfficeMini, fitSplit, placeTiles } from './sessions/layout.js'

export function setTab(name) {
  if (!['sessions', 'office', 'reports'].includes(name)) name = 'sessions'
  const isOffice = name === 'office'
  $('#view-sessions').hidden = name !== 'sessions'
  $('#view-office').hidden = !isOffice
  $('#view-reports').hidden = name !== 'reports'
  // Charts measure their box when drawn: draw them once the tab is showing.
  if (name === 'reports') requestAnimationFrame(() => { renderCharts(); renderTimeline(); renderContextBars() })
  $('#view-toggle').hidden = name !== 'sessions'
  placeTiles()
  if (name === 'sessions') requestAnimationFrame(() => { fitSplit(); drawOfficeMini() })
  document.querySelectorAll('[data-tab]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === name)))
  remember('fleet-tab', name)
  office.setActive(isOffice)
}

export function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(tab => tab.addEventListener('click', () => setTab(tab.dataset.tab)))
}
