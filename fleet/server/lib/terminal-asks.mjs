// A session in a terminal shows a permission prompt in its own dialog and on the
// page at once (hooks/lib/asks.ts). The mod closes that dialog itself for a
// Deny, but an Allow has to be given in the dialog, so it is given here, the way
// the "Switch model?" question is answered: the session's tab is read first, and
// Return is pressed only while that very prompt is on screen with its Yes
// picked. The same reading notices a prompt answered in the terminal, so its
// card leaves the page.

import { READ_ITERM_TAB, READ_TERMINAL_TAB, TYPE_INTO_ITERM, TYPE_INTO_TAB, osascript } from './applescript.mjs'
import { asks, live } from './state.mjs'
import { claudeHasForeground } from './typing.mjs'
import { sleep } from './utils.mjs'

// The dialog is everything under the last solid rule on the screen, and ends
// with this hint (a plan's asks whether to proceed instead); its first option,
// "Yes", is the one picked when it opens.
const SOLID_RULE = /^\s*─{20,}\s*$/
const DIALOG_HINT = /Esc to cancel|Would you like to proceed\?/
const YES_PICKED = /^\s*❯\s*1\.\s*Yes\s*$/m
const PRESS_SETTLE_MS = 2500

// What on screen tells this prompt from another one queued behind it: Bash's
// command, the file's name, the page's host. Empty for a tool with none.
function promptMarker(ask) {
  const input = ask.toolInput || {}
  if (typeof input.command === 'string') return input.command.trim().split('\n')[0].slice(0, 40).trim()
  const filePath = input.file_path || input.notebook_path
  if (typeof filePath === 'string') return filePath.split('/').pop()
  if (typeof input.url === 'string') {
    try { return new URL(input.url).host } catch { return '' }
  }
  return ''
}

function dialogOf(screen) {
  const lines = String(screen || '').trimEnd().split('\n')
  let start = lines.length - 1
  while (start >= 0 && !SOLID_RULE.test(lines[start])) start--
  const dialog = lines.slice(start + 1).join('\n')
  return DIALOG_HINT.test(dialog) ? dialog : ''
}

// Whether `dialog` is this ask's prompt. A tool with nothing to tell it by counts
// only while it is the session's one open prompt, so another's is never answered.
function showsPrompt(dialog, ask) {
  if (!dialog) return false
  const marker = promptMarker(ask)
  if (marker) return dialog.includes(marker)
  for (const other of asks.values()) {
    if (other !== ask && other.sessionId === ask.sessionId && other.inTerminal && other.kind === 'permission' && !other.answer) return false
  }
  return true
}

// The session's tab, read: its open dialog (empty when none) and how to type
// into it. Unreadable when the session has no tab Terminal or iTerm2 can find.
async function readTab(ask) {
  const tty = live.get(ask.sessionId)?.tty
  if (!tty) return { isReadable: false }
  for (const [reader, typer] of [[READ_TERMINAL_TAB, TYPE_INTO_TAB], [READ_ITERM_TAB, TYPE_INTO_ITERM]]) {
    const screen = (await osascript(reader, `/dev/${tty}`).catch(() => ({ stdout: '' }))).stdout
    if (screen.trim()) return { isReadable: true, tty, typer, dialog: dialogOf(screen) }
  }
  return { isReadable: false }
}

// Gives the page's answer in the terminal. `{ ok: true }` when the answer can
// stand: a Deny, which the mod then gives by closing the dialog, or an Allow
// whose Yes was pressed and the dialog closed. `isGone` when the prompt is no
// longer there, answered in the terminal. `record` is called just before Yes
// is pressed, so the mod has the Allow (and its "for this session") by the time
// the tool runs.
export async function answerInTerminal(ask, answer, record) {
  const tab = await readTab(ask)
  if (!tab.isReadable) return { ok: false, reason: 'Fleet cannot read its terminal tab: answer it there.' }
  // Seen before and gone now, it was answered in the terminal: a Deny now would cut
  // short the tool it let run. Never seen, the prompt may be one this reading does
  // not know, so the card stays for the terminal to settle.
  if (!showsPrompt(tab.dialog, ask)) {
    return ask.wasSeen
      ? { ok: false, isGone: true, reason: 'It was already answered in its terminal.' }
      : { ok: false, reason: 'Fleet cannot find that prompt in its tab: answer it there.' }
  }
  ask.wasSeen = true
  if (!answer.allow) return { ok: true }
  if (ask.toolName === 'ExitPlanMode') return { ok: false, reason: 'Approve it in its terminal: its options also choose how edits are approved.' }
  if (!YES_PICKED.test(tab.dialog)) return { ok: false, reason: 'Another option is picked in its terminal: answer it there.' }
  if (!(await claudeHasForeground(tab.tty))) return { ok: false, reason: 'Claude is not in the foreground of its tab.' }
  // An empty line is a lone Return: the dialog takes it as Enter on the option picked.
  // Pressed at most twice, and the second time only if this prompt is still waiting.
  record()
  for (let press = 0; press < 2; press++) {
    await osascript(tab.typer, `/dev/${tab.tty}`, '')
    await sleep(PRESS_SETTLE_MS)
    const after = await readTab(ask)
    if (!after.isReadable || !showsPrompt(after.dialog, ask)) return { ok: true }
    if (!YES_PICKED.test(after.dialog)) break
  }
  return { ok: false, reason: 'It is still waiting in its terminal: press Enter there.' }
}

// Every 2 seconds with the registry scan: a terminal prompt the screen showed
// and no longer does was answered there, so its card goes (`cancel`). One
// that was never seen is left to the mod, which cancels it when its call ends.
let isWatching = false
export async function watchTerminalPrompts(cancel) {
  if (isWatching) return
  isWatching = true
  try {
    for (const ask of [...asks.values()]) {
      if (!ask.inTerminal || ask.kind !== 'permission' || ask.answer || ask.isAnswering) continue
      const tab = await readTab(ask)
      if (!tab.isReadable || ask.answer || ask.isAnswering) continue
      if (showsPrompt(tab.dialog, ask)) ask.wasSeen = true
      else if (ask.wasSeen) cancel({ id: ask.id })
    }
  } finally {
    isWatching = false
  }
}
