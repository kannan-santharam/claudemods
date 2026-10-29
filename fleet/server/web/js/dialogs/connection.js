// The lost-connection dialog, the reconnect probe and the "updated" pulse in
// the header.

import { $ } from '../core/dom.js'
import { timeAgo } from '../core/format.js'
import { state } from '../core/state.js'
import { refreshLive, refreshReport } from '../refresh.js'

// down: nothing answers. signin: the server answers but this browser is not
// signed in (a new browser, cleared cookies, an expired link): /fleet web signs it in.
let connection = 'ok'
let dismissedState = ''
export function setConnection(next) {
  if (next === connection) return
  connection = next
  const dialog = $('#lost')
  if (next === 'ok') { dialog.hidden = true; dismissedState = ''; return }
  const copy = {
    down: ['Lost connection to the Fleet server', 'The dashboard server is not answering. Any open Claude session starts it again within 30 seconds; this page reconnects by itself when it is back.', '!'],
    signin: [new URLSearchParams(location.search).get('signin') === 'expired' ? 'That sign-in link has expired' : 'Open the dashboard from Claude',
      'For your privacy the dashboard only opens for you: run /fleet web in any Claude session and it opens here signed in.', '↻'],
  }[next]
  $('#lost-title').textContent = copy[0]
  $('#lost-text').textContent = copy[1]
  $('#lost-icon').textContent = copy[2]
  $('#lost-icon').classList.toggle('ok', next === 'signin')
  $('#lost-reload').hidden = next === 'signin'
  dialog.hidden = dismissedState === next
  if (!dialog.hidden) $('#lost-reload').focus()
}

export function initConnection() {
  $('#lost-reload').addEventListener('click', () => location.reload())
  $('#lost-dismiss').addEventListener('click', () => { dismissedState = connection; $('#lost').hidden = true })
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#lost').hidden) { dismissedState = connection; $('#lost').hidden = true }
  })
  setInterval(async () => {
    if (connection === 'ok') return
    try {
      const health = await fetch('/api/health', { cache: 'no-store' })
      if (!health.ok) return
      const probe = await fetch('/api/live', { credentials: 'same-origin', headers: { 'x-fleet-request': '1' } })
      if (probe.status === 401) setConnection('signin')
      else if (probe.ok) { setConnection('ok'); refreshLive(); refreshReport() }
    } catch {
      setConnection('down')
    }
  }, 2000)

  setInterval(() => {
    if (!state.lastLiveOk) return
    const stale = Date.now() - state.lastLiveOk > 8000
    if (stale && connection === 'ok') setConnection('down')
    $('#pulse').classList.toggle('stale', stale)
    $('#updated').textContent = stale ? 'Server not answering — is a Claude session running?' : 'Live · updated ' + timeAgo(state.lastLiveOk) + ' ago'
  }, 1000)
}
