import { FOCUS_ITERM, FOCUS_TERMINAL, IS_RUNNING, OPEN_IN_ITERM, OPEN_IN_TERMINAL, osascript } from './applescript.mjs'
import { live } from './state.mjs'

// New windows open in the terminal you use: Terminal if it is open, else
// iTerm2 if that is, else Terminal.
// A new session opens as a tab in the front window when it can, else in a new window.
export async function openInTerminal(command) {
  const terminalRunning = (await osascript(IS_RUNNING, 'Terminal')).stdout.trim() === 'yes'
  const itermRunning = !terminalRunning && (await osascript(IS_RUNNING, 'iTerm2')).stdout.trim() === 'yes'
  const result = await osascript(itermRunning ? OPEN_IN_ITERM : OPEN_IN_TERMINAL, command)
  const answer = result.stdout.trim()
  if (answer === 'tab' || answer === 'window') return { ok: true, command, where: answer }
  if (answer === 'window-no-access') {
    return { ok: true, command, where: 'window', hint: 'To open new sessions as tabs instead, allow Terminal in System Settings › Privacy & Security › Accessibility.' }
  }
  if (result.stderr.includes('-1743'))
    return { ok: false, reason: 'macOS blocked it: allow control of Terminal in System Settings › Privacy & Security › Automation.' }
  return { ok: false, reason: result.stderr.trim() || 'Terminal did not open.' }
}

export async function focusTab(sessionId) {
  const session = live.get(sessionId)
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  if (!session.tty) return { ok: false, reason: 'That session has no terminal tab.' }
  const device = `/dev/${session.tty}`
  for (const script of [FOCUS_TERMINAL, FOCUS_ITERM]) {
    const result = await osascript(script, device)
    if (result.stdout.trim() === 'ok') return { ok: true }
    if (result.stderr.includes('-1743'))
      return { ok: false, reason: 'macOS blocked it: allow control of Terminal in System Settings › Privacy & Security › Automation.' }
  }
  return { ok: false, reason: `No Terminal or iTerm2 tab is on ${device}.` }
}
