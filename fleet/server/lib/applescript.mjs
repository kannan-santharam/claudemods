import { terminal } from './state.mjs'
import { run } from './utils.mjs'

// AppleScript sources, each run with `osascript -e <source> <args>`.

export const FOCUS_TERMINAL = `on run argv
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

export const FOCUS_ITERM = `on run argv
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

// Terminal has no command for a new tab, so with a window already open it
// presses ⌘T and waits for the tab to appear. Pressing keys needs the
// Accessibility permission; without it the session opens in a new window
// and the answer says why. Answers "tab", "window" or "window-no-access".
export const OPEN_IN_TERMINAL = `on run argv
  set theCommand to item 1 of argv
  tell application "Terminal"
    set hasWindow to (count of windows) > 0
    activate
  end tell
  if hasWindow then
    tell application "Terminal" to set tabsBefore to count of tabs of front window
    try
      tell application "System Events" to tell process "Terminal" to keystroke "t" using command down
    on error
      tell application "Terminal" to do script theCommand
      return "window-no-access"
    end try
    repeat 20 times
      delay 0.1
      tell application "Terminal" to set tabsNow to count of tabs of front window
      if tabsNow > tabsBefore then
        tell application "Terminal" to do script theCommand in selected tab of front window
        return "tab"
      end if
    end repeat
  end if
  tell application "Terminal" to do script theCommand
  return "window"
end run`

export const OPEN_IN_ITERM = `on run argv
  tell application "iTerm2"
    activate
    if (count of windows) > 0 then
      tell current window to create tab with default profile
      tell current session of current window to write text (item 1 of argv)
      return "tab"
    end if
    set newWindow to (create window with default profile)
    tell current session of newWindow to write text (item 1 of argv)
  end tell
  return "window"
end run`

export const IS_RUNNING = `on run argv
  if application (item 1 of argv) is running then return "yes"
  return "no"
end run`

export const TYPE_INTO_ITERM = `on run argv
  set target to item 1 of argv
  if application "iTerm2" is not running then return "notfound"
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is target then
            tell s to write text (item 2 of argv) newline no
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

export const TYPE_INTO_TAB = `on run argv
  set target to item 1 of argv
  if application "Terminal" is not running then return "notfound"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          do script (item 2 of argv) in t
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

export const READ_TERMINAL_TAB = `on run argv
  if application "Terminal" is not running then return ""
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then return history of t
      end repeat
    end repeat
  end tell
  return ""
end run`
export const READ_ITERM_TAB = `on run argv
  if application "iTerm2" is not running then return ""
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is (item 1 of argv) then return text of s
        end repeat
      end repeat
    end repeat
  end tell
  return ""
end run`

export const EXIT_TERMINAL_SHELL = `on run argv
  if application "Terminal" is not running then return "notfound"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then
          do script "exit" in t
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "notfound"
end run`
export const TERMINAL_TAB_EXISTS = `on run argv
  if application "Terminal" is not running then return "no"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then return "yes"
      end repeat
    end repeat
  end tell
  return "no"
end run`
export const CLOSE_TERMINAL_TAB = `on run argv
  if application "Terminal" is not running then return "notfound"
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is (item 1 of argv) then
          if (count of tabs of w) is 1 then
            close w
            return "closed"
          end if
          set selected tab of w to t
          set index of w to 1
          activate
          tell application "System Events" to tell process "Terminal" to keystroke "w" using command down
          return "closed"
        end if
      end repeat
    end repeat
  end tell
  return "notfound"
end run`
export const CLOSE_ITERM_SESSION = `on run argv
  if application "iTerm2" is not running then return "notfound"
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is (item 1 of argv) then
            close s
            return "closed"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "notfound"
end run`

// AppleScript calls against Terminal run one at a time: twenty sessions' worth
// of focus, typing and new windows never interleave.
function inTerminalQueue(task) {
  const result = terminal.queue.then(task, task)
  terminal.queue = result.catch(() => {})
  return result
}
export const osascript = (...args) => inTerminalQueue(() => run('osascript', ['-e', ...args]))
