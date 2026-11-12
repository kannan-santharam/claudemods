// The note above the message box while a session may be stuck: why Fleet
// thinks so, since when, and the error that keeps coming back. Dimmed, so it
// reads as Fleet's note and not as a message.

import { escapeHtml, timeAgo } from '../core/format.js'

export function stuckNoteHtml(session) {
  const { stuck } = session
  if (!stuck) return ''
  return `<div class="stuck-note" role="note"><div class="stuck-why"><b>May be stuck</b> · ${escapeHtml(stuck.reason)}${stuck.since ? ` · for ${timeAgo(stuck.since)}` : ''}</div>${stuck.evidence ? `<code class="stuck-error" title="${escapeHtml(stuck.evidence)}">${escapeHtml(stuck.evidence)}</code>` : ''}</div>`
}
