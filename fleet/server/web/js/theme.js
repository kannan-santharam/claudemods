// Light and dark: the toggle in the header, and following the system while no
// choice has been made here.

import { $ } from './core/dom.js'
import { office } from './office/index.js'
import { renderAll } from './refresh.js'
import { drawOfficeMini } from './sessions/layout.js'

// The theme is always named on the root, so the dark styles apply whether it was
// chosen here or comes from the system. index.html names it before the first paint.
const systemTheme = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
const savedTheme = () => { try { return localStorage.getItem('fleet-theme') || '' } catch { return '' } }

export function initTheme() {
  $('#theme').addEventListener('click', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches
    const current = document.documentElement.dataset.theme || (dark ? 'dark' : 'light')
    const next = current === 'dark' ? 'light' : 'dark'
    document.documentElement.dataset.theme = next
    try { localStorage.setItem('fleet-theme', next) } catch {}
    renderAll()
    office.themeChanged()
    drawOfficeMini()
  })
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (!savedTheme()) document.documentElement.dataset.theme = systemTheme()
    renderAll()
  })
}
