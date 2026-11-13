// Hide my messages: the header's eye button blurs what you wrote wherever the page
// shows it (the conversation, the sent log, the resume lists), for a screen that
// other people can see. Pointing at a message shows it. The choice is kept in
// this browser; the text itself is still on the page, only blurred.

import { $ } from './core/dom.js'
import { remember, remembered } from './core/storage.js'

const TITLES = { hidden: 'Your messages are hidden. Point at one to read it. Click to show them all.', shown: 'Hide my messages' }

function apply(isHidden) {
  if (isHidden) document.documentElement.dataset.mine = 'hidden'
  else delete document.documentElement.dataset.mine
  const button = $('#hide-mine')
  button.setAttribute('aria-pressed', String(isHidden))
  button.title = isHidden ? TITLES.hidden : TITLES.shown
}

export function initPrivacy() {
  apply(remembered('fleet-hide-mine') === '1')
  $('#hide-mine').addEventListener('click', () => {
    const isHidden = document.documentElement.dataset.mine !== 'hidden'
    remember('fleet-hide-mine', isHidden ? '1' : '0')
    apply(isHidden)
  })
}
