// Messages for sessions without the mod are typed into their own terminal tab,
// one session at a time and only while it waits idle at its prompt.

import { READ_ITERM_TAB, READ_TERMINAL_TAB, TYPE_INTO_ITERM, TYPE_INTO_TAB, osascript } from './applescript.mjs'
import { acknowledge } from './messaging.mjs'
import { hasMod } from './registry.mjs'
import { live, messaging } from './state.mjs'
import { asTypedPrompt, run, sleep } from './utils.mjs'

async function typeIntoTab(tty, text) {
  if (!(await claudeHasForeground(tty))) return { ok: false, reason: 'Claude is not in the foreground of its tab' }
  for (const script of [TYPE_INTO_TAB, TYPE_INTO_ITERM]) {
    let result
    try {
      result = await osascript(script, `/dev/${tty}`, text)
    } catch {
      continue
    }
    if (result.stdout.trim() !== 'ok') continue
    // The terminal ends typed text with a line feed, which Claude Code reads as
    // "new line", not "send", and a fast burst reads as a paste whose Return is
    // swallowed. So the text goes in first (its line breaks stay line breaks),
    // then a carriage return, and the input box is read back: while the text is
    // still sitting there, Return is pressed again a little later.
    const reader = script === TYPE_INTO_TAB ? READ_TERMINAL_TAB : READ_ITERM_TAB
    const opening = text.split('\n')[0].trim().slice(0, 30)
    let waitMs = Math.min(6000, 2500 + text.length)
    for (let attempt = 0; attempt < 5; attempt++) {
      await sleep(waitMs)
      await osascript(script, `/dev/${tty}`, '\r')
      await sleep(1000)
      const inputText = inputBoxText((await osascript(reader, `/dev/${tty}`)).stdout)
      if (inputText === null || !(inputText.includes(opening) || inputText.includes('[Pasted text'))) return { ok: true, script }
      waitMs = 2000
    }
    return { ok: false, reason: 'it is still in its input box: press Enter in its tab' }
  }
  return { ok: false, reason: 'its Terminal or iTerm2 tab was not found' }
}

// What sits in Claude Code's input box: the lines between the last two rules
// drawn across the screen. null when the screen does not show one.
function inputBoxText(screen) {
  const lines = String(screen || '').trimEnd().split('\n')
  const rules = []
  for (let index = lines.length - 1; index >= 0 && rules.length < 2; index--) if (/^\s*─{20,}/.test(lines[index])) rules.push(index)
  return rules.length < 2 ? null : lines.slice(rules[1] + 1, rules[0]).join('\n')
}

// Typing is only safe while Claude itself is in the foreground of that tab: if
// the person quit it, the text would land in the shell and run there.
export async function claudeHasForeground(tty) {
  const listing = await run('ps', ['-t', tty, '-o', 'stat=,comm='])
  return listing.stdout.split('\n').some(line => {
    const [stat, ...command] = line.trim().split(/\s+/)
    return stat && stat.includes('+') && /(^|\/)claude$/.test(command.join(' '))
  })
}

export const MESSAGE_TTL_MS = 10 * 60 * 1000

// Messages for sessions without the mod: typed into each one's own tab, one
// session at a time, only while that session waits idle at its prompt.
export async function deliverTyped() {
  if (messaging.isTyping) return
  messaging.isTyping = true
  try {
    const now = Date.now()
    const handled = new Set()
    for (const item of [...messaging.inbox]) {
      if (handled.has(item.sessionId)) continue
      if (item.claimedAt && now - item.claimedAt < 30000) continue
      const session = live.get(item.sessionId)
      const fail = reason => {
        messaging.inbox = messaging.inbox.filter(other => other.id !== item.id)
        acknowledge(item.id, { isDelivered: false, reason, mode: 'typed' }, item)
      }
      if (!session) { fail('the session ended'); continue }
      if (now - item.createdAt > MESSAGE_TTL_MS) { fail('it was never idle in the next 10 minutes'); continue }
      // A connected session takes its own messages from /api/inbox.
      if (hasMod(item.sessionId)) continue
      if (session.status !== 'idle' || !session.tty) continue
      handled.add(item.sessionId)
      const text = item.command ? `/${item.command}${item.args ? ' ' + item.args : ''}` : asTypedPrompt(item.text)
      const typed = await typeIntoTab(session.tty, text)
      // Claude not in front (a shell, a pager): wait and try again, never type into it.
      if (!typed.ok && typed.reason.startsWith('Claude is not')) continue
      messaging.inbox = messaging.inbox.filter(other => other.id !== item.id)
      acknowledge(item.id, { isDelivered: typed.ok, reason: typed.ok ? '' : typed.reason, mode: 'typed' }, item)
      // It is busy now: the next message for it waits for the next idle.
      session.status = 'busy'
    }
  } finally {
    messaging.isTyping = false
  }
}
