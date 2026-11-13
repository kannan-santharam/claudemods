// Up and Down in the message box walk back through what you sent this session,
// as a terminal does. Nothing is kept for it: each press reads your messages
// from the conversation the pane has loaded from the transcript, plus what was
// sent from here and is not in the transcript yet, and going back past the
// loaded turns fetches the page before, as scrolling up does. What you had
// typed comes back when you step forward past the newest.

import { state } from '../core/state.js'
import { loadOlder, shownMessages } from './conversation.js'
import { matchOutbox } from './outbox.js'

// A long prompt is shown cut short; half a message is not worth bringing back.
const CUT_MARK = '… (cut here, the rest is in the terminal)'
// One press reads at most this many earlier pages looking for a message of yours.
const PAGES_PER_PRESS = 5
// Where each session's message box is in its history: -1 is the draft itself.
const positions = {}

// Your messages to a session, newest first, a repeat said twice in a row once.
function sentTexts(sessionId) {
  const messages = shownMessages({ sessionId })
  const texts = messages.filter(message => message.from === 'you' && message.text && !message.text.includes(CUT_MARK)).map(message => message.text)
  for (const entry of matchOutbox(sessionId, messages).waiting) texts.push(entry.text)
  return texts.filter((text, index) => text !== texts[index + 1]).reverse()
}

const isRecalling = sessionId => (positions[sessionId]?.index ?? -1) >= 0

// Up goes back from the first line of the box, so the arrow still moves the
// caret inside a draft of several lines; once a sent message is showing, Up and
// Down step through the history wherever the caret is.
export function wantsRecall(box, key) {
  const sessionId = box.dataset.draft
  if (isRecalling(sessionId)) return true
  if (key !== 'ArrowUp' || box.selectionStart !== box.selectionEnd) return false
  return !box.value.slice(0, box.selectionStart).includes('\n')
}

// Typing, or sending, makes what is in the box the draft again.
export function resetRecall(sessionId) {
  delete positions[sessionId]
}

export async function recallStep(sessionId, key) {
  const box = () => document.querySelector(`textarea[data-draft="${CSS.escape(sessionId)}"]`)
  const position = (positions[sessionId] ||= { index: -1, draft: '', isBusy: false })
  if (position.isBusy) return
  if (position.index < 0) position.draft = box()?.value ?? state.drafts[sessionId] ?? ''
  const next = position.index + (key === 'ArrowUp' ? 1 : -1)
  if (next < -1) return
  let texts = sentTexts(sessionId)
  if (next >= texts.length) {
    position.isBusy = true
    try {
      for (let pages = 0; next >= texts.length && pages < PAGES_PER_PRESS && state.conversations[sessionId]?.hasMore; pages++) {
        await loadOlder(sessionId)
        texts = sentTexts(sessionId)
      }
    } finally {
      position.isBusy = false
    }
    // Typed or sent while the page was being fetched: leave the box alone.
    if (positions[sessionId] !== position) return
    if (next >= texts.length) { if (position.index < 0) delete positions[sessionId]; return }
  }
  position.index = next
  const value = next < 0 ? position.draft : texts[next]
  if (next < 0) delete positions[sessionId]
  state.drafts[sessionId] = value
  const field = box()
  if (!field) return
  field.value = value
  field.setSelectionRange(value.length, value.length)
}
