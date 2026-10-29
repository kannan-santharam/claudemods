// Who is running: Claude Code's session registry (~/.claude/sessions) joined
// with `ps`, scanned every two seconds into the live map, with each status change
// kept in an eight-day status log for the timeline.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { DAY_MS, HEARTBEAT_FRESH_MS, HISTORY_DAYS, REGISTRY_DIR, STATUS_LOG_FILE } from './constants.mjs'
import { sweepAsks } from './asks.mjs'
import { isExcludedPath } from './config.mjs'
import { rememberClosed } from './recently-closed.mjs'
import { branchCache, files, heartbeats, lastStatus, live, metaCache, registryState } from './state.mjs'
import { baseName, run, writePrivate } from './utils.mjs'

// A readable name for the process that started a session: a shell says nothing,
// a script says its folder (node tools/test-runner/server.mjs → test-runner).
function launcherName(command) {
  const tokens = command.split(/\s+/).filter(Boolean)
  if (!tokens.length || /(^|\/)-?(zsh|bash|sh|fish|login)$/.test(tokens[0])) return ''
  const script = tokens.find(token => /\.(m?js|cjs|ts|py|sh)$/.test(token))
  if (script) {
    const parts = script.split('/')
    const file = parts.at(-1).replace(/\.[^.]+$/, '')
    return ['server', 'index', 'main', 'cli', 'run'].includes(file) && parts.length > 1 ? parts.at(-2) : file
  }
  return baseName(tokens[0])
}

export function loadStatusLog() {
  try {
    const cutoff = Date.now() - HISTORY_DAYS * DAY_MS
    registryState.statusLog = fs
      .readFileSync(STATUS_LOG_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => {
        try {
          return JSON.parse(line)
        } catch {
          return null
        }
      })
      .filter(entry => entry && entry.t >= cutoff)
    writePrivate(STATUS_LOG_FILE, registryState.statusLog.map(entry => JSON.stringify(entry)).join('\n') + (registryState.statusLog.length ? '\n' : ''))
  } catch {
    registryState.statusLog = []
  }
}

// Everything kept per session or per file is let go once it can no longer show.

export function pruneMemory() {
  const now = Date.now()
  for (const [sessionId, beat] of heartbeats) if (now - beat.at > 60 * 60 * 1000 && !live.has(sessionId)) heartbeats.delete(sessionId)
  for (const metaPath of metaCache.keys()) if (!files.has(metaPath.replace(/\.meta\.json$/, '.jsonl'))) metaCache.delete(metaPath)
  if (now - registryState.lastStatusTrim > 60 * 60 * 1000) {
    registryState.lastStatusTrim = now
    const cutoff = now - HISTORY_DAYS * DAY_MS
    registryState.statusLog = registryState.statusLog.filter(entry => entry.t >= cutoff)
    try {
      writePrivate(STATUS_LOG_FILE, registryState.statusLog.map(entry => JSON.stringify(entry)).join('\n') + (registryState.statusLog.length ? '\n' : ''))
    } catch {}
  }
}

function recordStatus(entry) {
  registryState.statusLog.push(entry)
  fs.appendFile(STATUS_LOG_FILE, JSON.stringify(entry) + '\n', { mode: 0o600 }, () => {})
}

async function readBranch(cwd) {
  const cached = branchCache.get(cwd)
  if (cached && Date.now() - cached.at < 10000) return cached.branch
  const result = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, timeout: 5000 })
  const branch = result.code === 0 ? result.stdout.trim() : ''
  branchCache.set(cwd, { at: Date.now(), branch })
  return branch
}

export async function scanRegistry() {
  let names = []
  try {
    names = (await fsp.readdir(REGISTRY_DIR)).filter(name => name.endsWith('.json'))
  } catch {
    return
  }
  const registrations = []
  for (const name of names) {
    try {
      const parsed = JSON.parse(await fsp.readFile(path.join(REGISTRY_DIR, name), 'utf8'))
      if (typeof parsed.pid === 'number' && typeof parsed.sessionId === 'string') registrations.push(parsed)
    } catch {}
  }

  const ttyByPid = new Map()
  if (registrations.length) {
    const listing = await run('ps', ['-o', 'pid=,tty=', '-p', registrations.map(entry => entry.pid).join(',')])
    for (const line of listing.stdout.split('\n')) {
      const [pidText, tty] = line.trim().split(/\s+/)
      if (pidText && tty) ttyByPid.set(Number(pidText), tty)
    }
  }

  // Which session started which: a session without a terminal (a `claude -p`
  // run, an SDK host) is filed under the session it descends from.
  const parentOf = new Map()
  const commandOf = new Map()
  const processTable = await run('ps', ['-A', '-o', 'pid=,ppid=,command='])
  for (const line of processTable.stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
    if (!match) continue
    parentOf.set(Number(match[1]), Number(match[2]))
    commandOf.set(Number(match[1]), match[3].slice(0, 300))
  }
  const sessionIdByPid = new Map(registrations.filter(entry => ttyByPid.has(entry.pid)).map(entry => [entry.pid, entry.sessionId]))
  const ancestry = pid => {
    let launcher = ''
    let current = parentOf.get(pid)
    for (let depth = 0; current && current > 1 && depth < 20; depth++) {
      if (sessionIdByPid.has(current)) return { parentSessionId: sessionIdByPid.get(current), launcher }
      if (!launcher) launcher = launcherName(commandOf.get(current) || '')
      current = parentOf.get(current)
    }
    return { parentSessionId: '', launcher }
  }

  const now = Date.now()
  const seen = new Set()
  for (const registration of registrations) {
    if (!ttyByPid.has(registration.pid) || isExcludedPath(registration.cwd)) continue
    seen.add(registration.sessionId)
    // A hidden session (`claude --bg`) has a terminal only inside Claude Code's background
    // service: it has no tab to focus or type into, and is reached by its job id.
    const hidden = registration.kind === 'bg'
    const tty = hidden ? '' : ttyByPid.get(registration.pid)
    const status = registration.status || 'unknown'
    const name = registration.name || baseName(registration.cwd)
    if (lastStatus.get(registration.sessionId) !== status) {
      recordStatus({ t: now, sessionId: registration.sessionId, name, status })
      lastStatus.set(registration.sessionId, status)
    }
    live.set(registration.sessionId, {
      sessionId: registration.sessionId,
      pid: registration.pid,
      tty: tty === '??' ? '' : tty,
      name,
      cwd: registration.cwd,
      folder: baseName(registration.cwd),
      branch: await readBranch(registration.cwd),
      status,
      waitingFor: registration.waitingFor || '',
      updatedAt: registration.statusUpdatedAt || registration.updatedAt || 0,
      startedAt: registration.startedAt || 0,
      version: registration.version || '',
      kind: registration.kind || '',
      hidden,
      jobId: hidden ? String(registration.jobId || registration.sessionId.slice(0, 8)) : '',
      nameSource: registration.nameSource || '',
      entrypoint: registration.entrypoint || '',
      ...ancestry(registration.pid),
    })
  }
  for (const sessionId of [...live.keys()]) {
    if (seen.has(sessionId)) continue
    rememberClosed(live.get(sessionId), now)
    live.delete(sessionId)
    heartbeats.delete(sessionId)
    recordStatus({ t: now, sessionId, name: '', status: 'ended' })
    lastStatus.delete(sessionId)
  }
  if (live.size) registryState.lastSeenLiveAt = now
  sweepAsks(now)
}

export function hasMod(sessionId) {
  const beat = heartbeats.get(sessionId)
  return Boolean(beat && Date.now() - beat.at < HEARTBEAT_FRESH_MS)
}
