import { $ } from './core/dom.js'

// ---------------------------------------------------------------- tooltips --
export const tip = $('#tip')

export function initTooltip() {
  document.addEventListener('mousemove', event => {
    if (event.target.id === 'office-canvas') return
    const el = event.target.closest && event.target.closest('[data-tip]')
    if (!el) { tip.style.display = 'none'; return }
    tip.textContent = el.dataset.tip
    tip.style.display = 'block'
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 12) + 'px'
    tip.style.top = (event.clientY + 14) + 'px'
  })
}
