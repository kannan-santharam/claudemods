// The last sessions that closed, kept across restarts so the page can offer to
// resume them.

import fs from 'node:fs'
import { DAY_MS, RECENTLY_CLOSED_FILE } from './constants.mjs'
import { isExcludedPath } from './config.mjs'
import { baseModel } from './pricing.mjs'
import { displayName, sessionSummaries } from './reports.mjs'
import { heartbeats, live, registryState } from './state.mjs'
import { dayKey, writePrivate } from './utils.mjs'

// The last ten sessions that closed, with what it takes to resume them, kept
// across restarts. Only sessions that had a terminal tab: a headless run is
// not something to reopen.
const RECENTLY_CLOSED_LIMIT = 10

export function loadRecentlyClosed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RECENTLY_CLOSED_FILE, 'utf8'))
    registryState.recentlyClosed = Array.isArray(parsed) ? parsed.slice(0, RECENTLY_CLOSED_LIMIT) : []
  } catch {
    registryState.recentlyClosed = []
  }
}
export function rememberClosed(session, endedAt) {
  if (!session || !session.tty) return
  const summary = sessionSummaries(dayKey(endedAt - 7 * DAY_MS)).get(session.sessionId)
  const entry = {
    sessionId: session.sessionId,
    name: displayName(session, summary),
    cwd: session.cwd,
    folder: session.folder,
    model: baseModel(heartbeats.get(session.sessionId)?.model) || summary?.model || '',
    lastPrompt: String(summary?.lastPrompt || '').slice(0, 300),
    startedAt: session.startedAt || 0,
    endedAt,
  }
  registryState.recentlyClosed = [entry, ...registryState.recentlyClosed.filter(other => other.sessionId !== entry.sessionId)].slice(0, RECENTLY_CLOSED_LIMIT)
  try { writePrivate(RECENTLY_CLOSED_FILE, JSON.stringify(registryState.recentlyClosed, null, 1)) } catch {}
}
export function listRecentlyClosed() {
  return registryState.recentlyClosed
    .filter(entry => !live.has(entry.sessionId) && !isExcludedPath(entry.cwd) && fs.existsSync(entry.cwd))
    .map(entry => ({ ...entry, cwd: undefined }))
}
