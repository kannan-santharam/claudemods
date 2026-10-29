import type { EngineInterface } from 'claude-code'

import type { FleetSession } from '../../types'

const FOCUS_TERMINAL = `on run argv
  set target to item 1 of argv
  if application "Terminal" is not running then return "notfound"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set selected tab of w to t
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

const FOCUS_ITERM = `on run argv
  set target to item 1 of argv
  if application "iTerm2" is not running then return "notfound"
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is target then
            select w
            select t
            select s
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

export async function focusTab($: EngineInterface, session: FleetSession): Promise<void> {
  if (!session.tty) {
    $.ui.toast(`${session.name} has no terminal tab`)
    return
  }
  const device = `/dev/${session.tty}`
  for (const script of [FOCUS_TERMINAL, FOCUS_ITERM]) {
    try {
      const result = await $.process.run(['osascript', '-e', script, device], { timeoutMs: 10000 })
      if (result.stdout.trim() === 'ok') return
      if (result.exitCode !== 0 && result.stderr.includes('-1743')) {
        $.ui.toast('Allow Claude to control your terminal in System Settings › Privacy › Automation')
        return
      }
    } catch {
      // That app is not installed or did not answer: try the next.
    }
  }
  $.ui.toast(`No terminal tab found on ${device}`)
}
