// The hover tooltip for anything with a data-tip attribute.

import { $ } from './core/dom.js'

export const tip = $('#tip')

export function initTooltip() {
  document.addEventListener('mousemove', event => {
    if (event.target.id === 'office-canvas') return
    const tipTarget = event.target.closest && event.target.closest('[data-tip]')
    if (!tipTarget) { tip.style.display = 'none'; return }
    tip.textContent = tipTarget.dataset.tip
    tip.style.display = 'block'
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 12) + 'px'
    tip.style.top = (event.clientY + 14) + 'px'
  })
}
