// Ending a session: SIGTERM (or SIGKILL when forced) for a session in a tab,
// `claude stop` for a hidden one, then closing a tab left with only its shell.

import crypto from 'node:crypto'
import { CLOSE_ITERM_SESSION, CLOSE_TERMINAL_TAB, EXIT_TERMINAL_SHELL, TERMINAL_TAB_EXISTS, osascript } from './applescript.mjs'
import { claudeBinary } from './hidden-sessions.mjs'
import { scanRegistry } from './registry.mjs'
import { deliveries, live, liveCache } from './state.mjs'
import { baseName, run, stripAnsi } from './utils.mjs'

// A process that exited but was not yet reaped by its parent (a zombie) still
// answers signal 0: ps's state says whether it really runs.
async function isAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  const processState = (await run('ps', ['-o', 'stat=', '-p', String(pid)])).stdout.trim()
  return Boolean(processState) && !processState.startsWith('Z')
}

// Closing the tab of an ended session: only when nothing but a shell is left on
// it, so a tab still running something else (a server, an editor) stays open.
// The shell is asked to exit first, which closes the tab without taking focus
// when Terminal closes tabs whose shell exits; else the tab is closed directly.
const SHELL_NAMES = /^-?(zsh|bash|fish|sh|login|tcsh|ksh)$/
async function onlyShellsOn(tty) {
  const listing = await run('ps', ['-t', tty, '-o', 'comm='])
  return listing.stdout.split('\n').map(line => baseName(line.trim())).filter(Boolean).every(name => SHELL_NAMES.test(name))
}

async function closeTab(tty) {
  if (!tty) return { closed: false }
  const device = `/dev/${tty}`
  if (!(await onlyShellsOn(tty))) return { closed: false, reason: 'its tab still runs something else, so it was left open' }
  if ((await osascript(CLOSE_ITERM_SESSION, device)).stdout.trim() === 'closed') return { closed: true }
  if ((await osascript(EXIT_TERMINAL_SHELL, device)).stdout.trim() !== 'ok') return { closed: false }
  for (let waited = 0; waited < 1500; waited += 250) {
    await new Promise(resolve => setTimeout(resolve, 250))
    if ((await osascript(TERMINAL_TAB_EXISTS, device)).stdout.trim() === 'no') return { closed: true }
  }
  // The shell exited but Terminal keeps tabs open after it: close the tab itself.
  const result = await osascript(CLOSE_TERMINAL_TAB, device)
  return { closed: result.stdout.trim() === 'closed', reason: result.stderr.includes('1002') || result.stderr.includes('assistive') ? 'closing the tab needs Terminal in Accessibility' : '' }
}

async function stopHidden(session) {
  const result = await run(claudeBinary(), ['stop', session.jobId], { timeout: 20000 })
  for (let waited = 0; waited < 8000 && (await isAlive(session.pid)); waited += 250) {
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const ended = !(await isAlive(session.pid))
  return { ended, reason: ended ? '' : stripAnsi(result.stderr || result.stdout).trim().split('\n')[0] || 'it is still running' }
}

// SIGTERM lets Claude Code finish writing its transcript, so the session can be
// resumed later; `force` (SIGKILL) is for one that did not stop. The pid is
// checked to still be a claude process, never just any pid the page names.
export async function endSession(body) {
  const session = live.get(String(body.sessionId || ''))
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  if (session.hidden) {
    const stopped = await stopHidden(session)
    liveCache.at = 0
    deliveries.push({ id: crypto.randomUUID(), sessionId: session.sessionId, name: session.name, text: 'ended the hidden session', at: Date.now(), isDelivered: stopped.ended, reason: stopped.reason, via: 'end' })
    if (stopped.ended) await scanRegistry()
    return stopped.ended ? { ok: true } : { ok: false, reason: `It did not stop: ${stopped.reason}` }
  }
  const listing = await run('ps', ['-o', 'command=', '-p', String(session.pid)])
  if (!/(^|\/)claude(\s|$)/.test(listing.stdout.trim().split('\n')[0] || '')) {
    return { ok: false, reason: 'Its process is no longer a Claude session.' }
  }
  const force = body.force === true
  try {
    process.kill(session.pid, force ? 'SIGKILL' : 'SIGTERM')
  } catch (error) {
    return { ok: false, reason: error.code === 'EPERM' ? 'Not allowed to end that process.' : error.message }
  }
  for (let waited = 0; waited < 5000 && (await isAlive(session.pid)); waited += 250) {
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const ended = !(await isAlive(session.pid))
  liveCache.at = 0
  deliveries.push({
    id: crypto.randomUUID(),
    sessionId: session.sessionId,
    name: session.name,
    text: force ? 'force-ended the session' : 'ended the session',
    at: Date.now(),
    isDelivered: ended,
    reason: ended ? '' : 'it is still running',
    via: 'end',
  })
  if (ended) await scanRegistry()
  if (!ended) return { ok: false, stillRunning: true, reason: 'It has not stopped yet. End it again to force it.' }
  const tab = body.closeTab === false ? { closed: false } : await closeTab(session.tty)
  return { ok: true, tabClosed: tab.closed, tabNote: tab.reason || '' }
}
