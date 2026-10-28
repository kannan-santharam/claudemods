// Fleet: a local dashboard of every Claude Code session on this machine.
//
// One process per machine, bound to 127.0.0.1; the port is the lock, so a
// second start exits. The fleet mod starts it from any session that finds it
// down, heartbeats its own session into it, and delivers what the page sends.
//
// Reads: ~/.claude/sessions/*.json (who is running), `ps` (alive, which tty),
// git (branch), ~/.claude/projects/**/*.jsonl (tokens, tools, activity).
// Writes: ~/.claude/fleet/ (token, pricing, status log, server log).

import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PORT = Number(process.env.FLEET_PORT || 8770)
const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude')
const REGISTRY_DIR = path.join(CLAUDE_DIR, 'sessions')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')
// FLEET_DATA_DIR runs a second dashboard (another port) without sharing the first one's token.
const DATA_DIR = process.env.FLEET_DATA_DIR || path.join(CLAUDE_DIR, 'fleet')
const TOKEN_FILE = path.join(DATA_DIR, 'token')
const PRICING_FILE = path.join(DATA_DIR, 'pricing.json')
const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
const STATUS_LOG_FILE = path.join(DATA_DIR, 'status-log.jsonl')
const RECENTLY_CLOSED_FILE = path.join(DATA_DIR, 'recently-closed.json')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGE_FILE = path.join(HERE, 'dashboard.html')

const REGISTRY_POLL_MS = 2000
const TRANSCRIPT_POLL_MS = 15000
const HISTORY_DAYS = 8
const HEARTBEAT_FRESH_MS = 15000
const IDLE_EXIT_MS = 60 * 60 * 1000
const ACTIVITY_GAP_MIN = 2
const DAY_MS = 24 * 60 * 60 * 1000

const BROWSER_SECRET_FILE = path.join(DATA_DIR, 'browser-secret')
const PLUGIN_MANIFEST = path.join(HERE, '..', '.claude-plugin', 'plugin.json')

// Two secrets, each kept 0600 in the data folder so a restart keeps them:
// TOKEN for the sessions' mods (they read the file), BROWSER_SECRET for the
// dashboard's cookie. Neither is ever written into a page.
let TOKEN = ''
let BROWSER_SECRET = ''

function loadSecret(file) {
  try {
    const kept = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{48}$/.test(kept)) {
      fs.chmodSync(file, 0o600)
      return kept
    }
  } catch {}
  const fresh = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(file, fresh, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return fresh
}

let VERSION = ''
try {
  VERSION = String(JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8')).version || '')
} catch {}

// Files this server writes hold your prompts' metadata: yours alone.
function writePrivate(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
}

// ---------------------------------------------------------------- pricing --

// API-equivalent list prices, USD per million tokens. On a subscription this
// is not a bill; it says what the same traffic would cost on the API.
// Edit ~/.claude/fleet/pricing.json to change any figure.
const DEFAULT_PRICING = {
  note: 'USD per million tokens. cacheWrite5m/cacheWrite1h/cacheRead default to 1.25x/2x/0.1x input when left out.',
  models: {
    'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
    'claude-fable-5': { input: 10, output: 50 },
    'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
    'claude-opus-5': { input: 5, output: 25 },
    'claude-opus-4-8': { input: 5, output: 25 },
    'claude-opus-4-7': { input: 5, output: 25 },
    'claude-opus-4-6': { input: 5, output: 25 },
    'claude-opus-4-5': { input: 5, output: 25 },
    'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
    'claude-sonnet-5': { input: 2, output: 10 },
    'claude-sonnet-4-6': { input: 3, output: 15 },
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-haiku-5-5': { input: 0.1, output: 0.5 },
    'claude-haiku-4-5': { input: 1, output: 5 },
  },
}

let pricing = DEFAULT_PRICING

function loadPricing() {
  try {
    pricing = JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'))
  } catch {
    pricing = DEFAULT_PRICING
    try {
      writePrivate(PRICING_FILE, JSON.stringify(DEFAULT_PRICING, null, 2))
    } catch {}
  }
}

function baseModel(model) {
  return String(model || '')
    .replace(/\[.*?\]$/, '')
    .replace(/-\d{8}$/, '')
}

function priceFor(model) {
  const models = pricing.models || {}
  const base = baseModel(model)
  let rate = models[base]
  if (!rate) {
    // An unlisted version of a known family takes that family's newest listed price.
    const family = ['fable', 'opus', 'sonnet', 'haiku'].find(name => base.includes(name))
    const fallbackKey = family && Object.keys(models).find(key => key.includes(family))
    rate = fallbackKey ? models[fallbackKey] : { input: 0, output: 0 }
  }
  return {
    input: rate.input,
    output: rate.output,
    cacheRead: rate.cacheRead ?? rate.input * 0.1,
    cacheWrite5m: rate.cacheWrite5m ?? rate.input * 1.25,
    cacheWrite1h: rate.cacheWrite1h ?? rate.input * 2,
  }
}

function costOf(model, tokens) {
  const rate = priceFor(model)
  return (
    (tokens.input * rate.input +
      tokens.output * rate.output +
      tokens.cacheRead * rate.cacheRead +
      tokens.cacheWrite5m * rate.cacheWrite5m +
      tokens.cacheWrite1h * rate.cacheWrite1h) /
    1_000_000
  )
}

function emptyTokens() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, messages: 0 }
}

function addTokens(into, from) {
  for (const key of Object.keys(into)) into[key] += from[key] || 0
}

// ----------------------------------------------------------------- config --

// Folders the fleet never reads: no session, transcript or figure from under them.
const DEFAULT_CONFIG = {
  note: 'excludePaths: folders (and everything under them) the dashboard ignores. newSessionRoot: the folder whose subfolders New session and Resume session offer. ~ is your home folder.',
  excludePaths: [],
  newSessionRoot: '~',
}

let excludedRoots = []
let newSessionRoot = ''

function loadConfig() {
  let config = DEFAULT_CONFIG
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    try {
      writePrivate(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
    } catch {}
  }
  const expand = entry => String(entry).replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, '')
  excludedRoots = (Array.isArray(config.excludePaths) ? config.excludePaths : []).map(expand).filter(Boolean)
  newSessionRoot = expand(config.newSessionRoot || DEFAULT_CONFIG.newSessionRoot)
  for (const sessionId of [...live.keys()]) if (isExcludedPath(live.get(sessionId).cwd)) live.delete(sessionId)
}

function isExcludedPath(cwd) {
  return Boolean(cwd) && excludedRoots.some(root => cwd === root || cwd.startsWith(root + '/'))
}

// A project folder under ~/.claude/projects is its cwd with every non-alphanumeric
// as '-', so a slug match can also be a sibling (~/api against ~/api-docs). The
// cwd a transcript records decides; its folder is skipped without being read.
const excludedDirCache = new Map() // dir -> { roots, isExcluded }
function isExcludedProjectDir(dirName, sampleFile) {
  const rootsKey = excludedRoots.join('\n')
  const cached = excludedDirCache.get(dirName)
  if (cached && cached.rootsKey === rootsKey) return cached.isExcluded
  let isExcluded = false
  const matches = excludedRoots.some(root => {
    const slug = root.replace(/[^a-zA-Z0-9]/g, '-')
    return dirName === slug || dirName.startsWith(slug + '-')
  })
  if (matches) {
    let cwd = ''
    try {
      const handle = fs.openSync(sampleFile, 'r')
      const buffer = Buffer.alloc(64 * 1024)
      const length = fs.readSync(handle, buffer, 0, buffer.length, 0)
      fs.closeSync(handle)
      cwd = buffer.subarray(0, length).toString('utf8').match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1] ?? ''
      cwd = cwd ? JSON.parse(`"${cwd}"`) : ''
    } catch {}
    isExcluded = cwd ? isExcludedPath(cwd) : excludedRoots.some(root => dirName === root.replace(/[^a-zA-Z0-9]/g, '-'))
  }
  excludedDirCache.set(dirName, { rootsKey, isExcluded })
  return isExcluded
}

function includedFiles() {
  return [...files.values()].filter(state => !isExcludedPath(state.cwd))
}

// ------------------------------------------------------------------ utils --

function run(command, args, options = {}) {
  return new Promise(resolve => {
    execFile(command, args, { timeout: 10000, maxBuffer: 8 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

function dayKey(time) {
  const date = new Date(time)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function baseName(filePath) {
  return filePath.split('/').filter(Boolean).at(-1) || filePath
}

function log(...parts) {
  console.log(new Date().toISOString(), ...parts)
}

// --------------------------------------------------------------- registry --

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

const live = new Map() // sessionId -> session row
const heartbeats = new Map() // sessionId -> heartbeat
const branchCache = new Map() // cwd -> { at, branch }
const lastStatus = new Map() // sessionId -> status
let statusLog = [] // { t, sessionId, name, status }
let lastSeenLiveAt = Date.now()

function loadStatusLog() {
  try {
    const cutoff = Date.now() - HISTORY_DAYS * DAY_MS
    statusLog = fs
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
    writePrivate(STATUS_LOG_FILE, statusLog.map(entry => JSON.stringify(entry)).join('\n') + (statusLog.length ? '\n' : ''))
  } catch {
    statusLog = []
  }
}

// Everything kept per session or per file is let go once it can no longer show.
let lastStatusTrim = Date.now()
function pruneMemory() {
  const now = Date.now()
  for (const [sessionId, beat] of heartbeats) if (now - beat.at > 60 * 60 * 1000 && !live.has(sessionId)) heartbeats.delete(sessionId)
  for (const metaPath of metaCache.keys()) if (!files.has(metaPath.replace(/\.meta\.json$/, '.jsonl'))) metaCache.delete(metaPath)
  if (now - lastStatusTrim > 60 * 60 * 1000) {
    lastStatusTrim = now
    const cutoff = now - HISTORY_DAYS * DAY_MS
    statusLog = statusLog.filter(entry => entry.t >= cutoff)
    try {
      writePrivate(STATUS_LOG_FILE, statusLog.map(entry => JSON.stringify(entry)).join('\n') + (statusLog.length ? '\n' : ''))
    } catch {}
  }
}

// The last ten sessions that closed, with what it takes to resume them, kept
// across restarts. Only sessions that had a terminal tab: a headless run is
// not something to reopen.
const RECENTLY_CLOSED_LIMIT = 10
let recentlyClosed = []
function loadRecentlyClosed() {
  try {
    const parsed = JSON.parse(fs.readFileSync(RECENTLY_CLOSED_FILE, 'utf8'))
    recentlyClosed = Array.isArray(parsed) ? parsed.slice(0, RECENTLY_CLOSED_LIMIT) : []
  } catch {
    recentlyClosed = []
  }
}
function rememberClosed(session, endedAt) {
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
  recentlyClosed = [entry, ...recentlyClosed.filter(other => other.sessionId !== entry.sessionId)].slice(0, RECENTLY_CLOSED_LIMIT)
  try { writePrivate(RECENTLY_CLOSED_FILE, JSON.stringify(recentlyClosed, null, 1)) } catch {}
}
function listRecentlyClosed() {
  return recentlyClosed
    .filter(entry => !live.has(entry.sessionId) && !isExcludedPath(entry.cwd) && fs.existsSync(entry.cwd))
    .map(entry => ({ ...entry, cwd: undefined }))
}

function recordStatus(entry) {
  statusLog.push(entry)
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

async function scanRegistry() {
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
  const table = await run('ps', ['-A', '-o', 'pid=,ppid=,command='])
  for (const line of table.stdout.split('\n')) {
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
  if (live.size) lastSeenLiveAt = now
  sweepAsks(now)
}

// ------------------------------------------------------------ transcripts --

// One entry per transcript file: what has been read and what it added up to.
const files = new Map()

function newFileState(filePath) {
  const relative = path.relative(PROJECTS_DIR, filePath).split(path.sep)
  // <project>/<session>.jsonl, or <project>/<session>/subagents/agent-*.jsonl
  const isSubagent = relative.includes('subagents')
  const sessionId = isSubagent ? relative[1] : baseName(filePath).replace(/\.jsonl$/, '')
  return {
    filePath,
    sessionId,
    isSubagent,
    offset: 0,
    size: 0,
    seenIds: new Set(),
    cwd: '',
    branch: '',
    model: '',
    title: '',
    firstAt: 0,
    lastAt: 0,
    lastPrompt: '',
    lastPromptAt: 0,
    lastReply: '',
    lastReplyAt: 0,
    lastTool: '',
    lastToolAt: 0,
    firstPrompt: '',
    agentName: '',
    prompts: 0,
    commits: 0,
    pushes: 0,
    contextTokens: 0,
    usage: {}, // day -> model -> tokens
    tools: {},
    filesTouched: {},
    activeMinutes: new Set(),
    shells: new Map(), // background shell id -> what it runs and when it ended
    bashInputs: new Map(), // tool_use id -> the Bash call, until its result says whether it went to the background
  }
}

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const SHELLS_KEPT = 40

// A background shell ends with a task notification, queued for the session as
// soon as the command exits: <task-id>…</task-id> … <status>completed</status>.
function noteTaskNotifications(state, text, time) {
  if (!text.includes('<task-notification>')) return
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = block.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
    const shell = id && state.shells.get(id)
    if (!shell || shell.endedAt) continue
    shell.endedAt = time || Date.now()
    shell.status = block.match(/<status>([^<]+)<\/status>/)?.[1]?.trim() || 'completed'
  }
}
// A Bash call sent to the background answers with its task id and output file.
function noteBackgroundShell(state, row, time) {
  const taskId = row.toolUseResult?.backgroundTaskId
  if (!taskId || state.shells.has(taskId)) return
  const result = (row.message.content || []).find(block => block?.type === 'tool_result')
  const call = (result && state.bashInputs.get(result.tool_use_id)) || {}
  const text = typeof result?.content === 'string' ? result.content : Array.isArray(result?.content) ? result.content.map(part => part?.text || '').join('\n') : ''
  state.shells.set(taskId, {
    id: String(taskId),
    command: String(call.command || '').slice(0, 400),
    description: String(call.description || '').slice(0, 160),
    startedAt: time || Date.now(),
    endedAt: 0,
    status: 'running',
    outputFile: text.match(/Output is being written to: (\S+?\.output)\b/)?.[1] || '',
  })
  if (state.shells.size > SHELLS_KEPT) state.shells.delete(state.shells.keys().next().value)
}

function ingestRow(state, row) {
  if (row.cwd && !state.cwd) state.cwd = row.cwd
  if (row.cwd) state.cwd = row.cwd
  if (row.gitBranch) state.branch = row.gitBranch
  if (row.type === 'custom-title' && row.customTitle) state.title = row.customTitle
  // Each typed prompt records the permission mode it was sent under.
  if (row.permissionMode && !row.isSidechain && !state.isSubagent) state.permissionMode = String(row.permissionMode)
  if (row.type === 'agent-name' && row.agentName) state.agentName = String(row.agentName)
  const time = row.timestamp ? Date.parse(row.timestamp) : 0
  if (time) {
    if (!state.firstAt) state.firstAt = time
    state.lastAt = Math.max(state.lastAt, time)
  }
  const message = row.message
  if (row.type === 'queue-operation' && typeof row.content === 'string' && !state.isSubagent) noteTaskNotifications(state, row.content, time)
  if (row.type === 'user' && message) {
    if (time) state.activeMinutes.add(Math.floor(time / 60000))
    if (!row.isSidechain && !state.isSubagent) {
      if (row.toolUseResult?.backgroundTaskId) noteBackgroundShell(state, row, time)
      if (row.origin?.kind === 'task-notification') noteTaskNotifications(state, typeof message.content === 'string' ? message.content : JSON.stringify(message.content), time)
    }
    // A typed prompt is a string; one sent with images is a list holding its text blocks.
    const typed = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content) && !message.content.some(block => block?.type === 'tool_result')
        ? message.content.filter(block => block?.type === 'text').map(block => block.text).join('\n')
        : ''
    if (!row.isMeta && typed) {
      const text = typed.trim()
      if (text && !text.startsWith('<')) {
        state.prompts++
        if (!state.firstPrompt) state.firstPrompt = text.slice(0, 200)
        state.lastPrompt = text.slice(0, 2000)
        state.lastPromptAt = time
      }
    }
    return
  }
  if (row.type !== 'assistant' || !message) return
  if (time) state.activeMinutes.add(Math.floor(time / 60000))
  if (!row.isSidechain && !state.isSubagent && Array.isArray(message.content)) {
    const reply = message.content
      .filter(block => block?.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n')
      .trim()
    if (reply) {
      state.lastReply = reply.slice(0, 6000)
      state.lastReplyAt = time
    }
  }
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type !== 'tool_use') continue
    const tool = String(block.name || 'unknown')
    state.tools[tool] = (state.tools[tool] || 0) + 1
    if (!row.isSidechain && !state.isSubagent) {
      state.lastTool = tool
      state.lastToolAt = time
    }
    const input = block.input || {}
    if (EDIT_TOOLS.has(tool) && (input.file_path || input.notebook_path)) {
      const touched = input.file_path || input.notebook_path
      state.filesTouched[touched] = (state.filesTouched[touched] || 0) + 1
    }
    if (tool === 'Bash' && !row.isSidechain && !state.isSubagent && block.id) {
      state.bashInputs.set(block.id, { command: input.command, description: input.description })
      if (state.bashInputs.size > 60) state.bashInputs.delete(state.bashInputs.keys().next().value)
    }
    if (tool === 'Bash' && /\bgit\s+(-C\s+\S+\s+)?commit\b/.test(String(input.command || ''))) state.commits++
    if (tool === 'Bash' && /\bgit\s+(-C\s+\S+\s+)?push\b/.test(String(input.command || ''))) state.pushes++
  }
  // Claude Code writes one row per content block of a response, each carrying
  // that response's whole usage: count each response id once.
  const usage = message.usage
  if (!usage || message.model === '<synthetic>') return
  const id = message.id || row.requestId || row.uuid
  if (id && state.seenIds.has(id)) return
  if (id) state.seenIds.add(id)
  const model = baseModel(message.model)
  if (!row.isSidechain && !state.isSubagent) {
    state.model = model
    state.contextTokens =
      (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  }
  const creation = usage.cache_creation || {}
  const write1h = creation.ephemeral_1h_input_tokens || 0
  const write5m = creation.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - write1h)
  const day = dayKey(time || Date.now())
  const byModel = (state.usage[day] ||= {})
  const tokens = (byModel[model] ||= emptyTokens())
  tokens.input += usage.input_tokens || 0
  tokens.output += usage.output_tokens || 0
  tokens.cacheRead += usage.cache_read_input_tokens || 0
  tokens.cacheWrite5m += write5m
  tokens.cacheWrite1h += write1h
  tokens.messages += 1
}

async function readNewLines(state, size) {
  const handle = await fsp.open(state.filePath, 'r')
  try {
    const chunkSize = 4 * 1024 * 1024
    let carry = ''
    while (state.offset < size) {
      const length = Math.min(chunkSize, size - state.offset)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, state.offset)
      if (!bytesRead) break
      const text = carry + buffer.subarray(0, bytesRead).toString('utf8')
      const lastNewline = text.lastIndexOf('\n')
      if (lastNewline < 0) {
        carry = text
        state.offset += bytesRead
        continue
      }
      for (const line of text.slice(0, lastNewline).split('\n')) {
        if (!line || line[0] !== '{') continue
        try {
          ingestRow(state, JSON.parse(line))
        } catch {}
      }
      carry = text.slice(lastNewline + 1)
      state.offset += bytesRead
    }
    // An unfinished last line is read again next time.
    state.offset -= Buffer.byteLength(carry, 'utf8')
  } finally {
    await handle.close()
  }
  // Ids only repeat within one response's rows, which are adjacent: keep the recent ones.
  if (state.seenIds.size > 2000) state.seenIds = new Set([...state.seenIds].slice(-500))
}

async function listTranscripts(dir, cutoff, found = []) {
  let entries = []
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await listTranscripts(full, cutoff, found)
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = await fsp.stat(full)
        if (stat.mtimeMs >= cutoff) found.push({ full, size: stat.size, mtimeMs: stat.mtimeMs })
      } catch {}
    }
  }
  return found
}

let isScanningTranscripts = false
let filesVersion = 0
let transcriptsReadyAt = 0

async function scanTranscripts() {
  if (isScanningTranscripts) return
  isScanningTranscripts = true
  try {
    const cutoff = Date.now() - HISTORY_DAYS * DAY_MS
    const listed = new Set()
    for (const { full, size, mtimeMs } of await listTranscripts(PROJECTS_DIR, cutoff)) {
      if (isExcludedProjectDir(path.relative(PROJECTS_DIR, full).split(path.sep)[0], full)) {
        files.delete(full)
        continue
      }
      listed.add(full)
      let state = files.get(full)
      if (!state || size < state.offset) {
        state = newFileState(full)
        files.set(full, state)
      }
      if (size > state.offset) {
        try {
          await readNewLines(state, size)
        } catch (error) {
          log('read failed', full, error.message)
        }
      }
      state.size = size
      // A transcript quiet for an hour gets no more rows of a response in progress.
      if (Date.now() - mtimeMs > 60 * 60 * 1000 && state.seenIds.size) state.seenIds = new Set()
    }
    // Transcripts past the history window, or deleted, leave memory too.
    for (const full of [...files.keys()]) if (!listed.has(full)) files.delete(full)
    filesVersion++
    transcriptsReadyAt = Date.now()
  } finally {
    isScanningTranscripts = false
  }
}

// ---------------------------------------------------------------- reports --

function sessionSummaries(sinceDay) {
  const sessions = new Map()
  for (const state of includedFiles()) {
    let summary = sessions.get(state.sessionId)
    if (!summary) {
      summary = {
        sessionId: state.sessionId,
        cwd: '',
        project: '',
        branch: '',
        model: '',
        title: '',
        firstAt: 0,
        lastAt: 0,
        lastPrompt: '',
        lastPromptAt: 0,
        lastReply: '',
        lastReplyAt: 0,
        lastTool: '',
        lastToolAt: 0,
        firstPrompt: '',
        agentName: '',
        prompts: 0,
        commits: 0,
        pushes: 0,
        contextTokens: 0,
        subagents: 0,
        tokens: emptyTokens(),
        cost: 0,
        byModel: {},
        tools: {},
        filesTouched: {},
      }
      sessions.set(state.sessionId, summary)
    }
    if (state.isSubagent) summary.subagents++
    else {
      summary.cwd = state.cwd || summary.cwd
      summary.branch = state.branch || summary.branch
      summary.model = state.model || summary.model
      summary.title = state.title || summary.title
      summary.agentName = state.agentName || summary.agentName
      summary.firstPrompt = summary.firstPrompt || state.firstPrompt
      if (state.lastPromptAt >= summary.lastPromptAt && state.lastPrompt) {
        summary.lastPrompt = state.lastPrompt
        summary.lastPromptAt = state.lastPromptAt
      }
      if (state.lastReplyAt >= summary.lastReplyAt && state.lastReply) {
        summary.lastReply = state.lastReply
        summary.lastReplyAt = state.lastReplyAt
      }
      if (state.lastToolAt >= summary.lastToolAt && state.lastTool) {
        summary.lastTool = state.lastTool
        summary.lastToolAt = state.lastToolAt
      }
      summary.contextTokens = state.contextTokens
      summary.prompts += state.prompts
    }
    summary.firstAt = summary.firstAt ? Math.min(summary.firstAt, state.firstAt || summary.firstAt) : state.firstAt
    summary.lastAt = Math.max(summary.lastAt, state.lastAt)
    summary.commits += state.commits
    summary.pushes += state.pushes
    for (const [day, byModel] of Object.entries(state.usage)) {
      if (day < sinceDay) continue
      for (const [model, tokens] of Object.entries(byModel)) {
        addTokens(summary.tokens, tokens)
        const modelTokens = (summary.byModel[model] ||= emptyTokens())
        addTokens(modelTokens, tokens)
        summary.cost += costOf(model, tokens)
      }
    }
    for (const [tool, count] of Object.entries(state.tools)) summary.tools[tool] = (summary.tools[tool] || 0) + count
    for (const [file, count] of Object.entries(state.filesTouched))
      summary.filesTouched[file] = (summary.filesTouched[file] || 0) + count
  }
  // A session known only from its subagents' files takes their cwd: one pass, not one per session.
  const cwdBySession = new Map()
  for (const state of includedFiles()) if (state.cwd && !cwdBySession.has(state.sessionId)) cwdBySession.set(state.sessionId, state.cwd)
  for (const summary of sessions.values()) {
    if (!summary.cwd) summary.cwd = cwdBySession.get(summary.sessionId) || ''
    summary.project = baseName(summary.cwd || 'unknown')
  }
  return sessions
}

function activitySegments(sessionId, since) {
  const minutes = []
  for (const state of includedFiles()) {
    if (state.sessionId !== sessionId) continue
    for (const minute of state.activeMinutes) if (minute * 60000 >= since) minutes.push(minute)
  }
  minutes.sort((left, right) => left - right)
  const segments = []
  for (const minute of minutes) {
    const last = segments.at(-1)
    if (last && minute - last[1] <= ACTIVITY_GAP_MIN) last[1] = minute
    else segments.push([minute, minute])
  }
  return segments.map(([start, end]) => [start * 60000, (end + 1) * 60000])
}

function statusSegments(sessionId, since, now) {
  const entries = statusLog.filter(entry => entry.sessionId === sessionId)
  const segments = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const end = entries[index + 1]?.t ?? (live.has(sessionId) ? now : entry.t)
    if (end < since || entry.status === 'ended') continue
    segments.push({ status: entry.status, start: Math.max(entry.t, since), end })
  }
  return segments
}

function buildReport(range) {
  const now = Date.now()
  const days = range === 'today' ? 1 : 7
  const since = now - days * DAY_MS
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
  const sinceDay = range === 'today' ? dayKey(now) : dayKey(since + DAY_MS)
  const summaries = sessionSummaries(sinceDay)

  const dayList = []
  for (let offset = 6; offset >= 0; offset--) dayList.push(dayKey(now - offset * DAY_MS))
  const perDay = Object.fromEntries(dayList.map(day => [day, {}]))
  const totals = { tokens: emptyTokens(), cost: 0, today: { tokens: emptyTokens(), cost: 0 } }
  const projects = {}
  const tools = {}
  const models = new Set()
  for (const state of includedFiles()) {
    for (const [day, byModel] of Object.entries(state.usage)) {
      for (const [model, tokens] of Object.entries(byModel)) {
        if (perDay[day]) {
          const entry = (perDay[day][model] ||= { tokens: 0, cost: 0 })
          entry.tokens += tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite5m + tokens.cacheWrite1h
          entry.cost += costOf(model, tokens)
          models.add(model)
        }
        if (day === dayKey(now)) {
          addTokens(totals.today.tokens, tokens)
          totals.today.cost += costOf(model, tokens)
        }
      }
    }
  }
  const sessionRows = []
  for (const summary of summaries.values()) {
    const total =
      summary.tokens.input + summary.tokens.output + summary.tokens.cacheRead + summary.tokens.cacheWrite5m + summary.tokens.cacheWrite1h
    if (summary.lastAt < since && !live.has(summary.sessionId)) continue
    addTokens(totals.tokens, summary.tokens)
    totals.cost += summary.cost
    const project = (projects[summary.project] ||= {
      project: summary.project,
      cwd: summary.cwd,
      sessions: 0,
      prompts: 0,
      tokens: 0,
      cost: 0,
      commits: 0,
      files: new Set(),
      tools: {},
      branches: new Set(),
    })
    project.sessions++
    project.prompts += summary.prompts
    project.tokens += total
    project.cost += summary.cost
    project.commits += summary.commits
    if (summary.branch) project.branches.add(summary.branch)
    for (const file of Object.keys(summary.filesTouched)) project.files.add(file)
    for (const [tool, count] of Object.entries(summary.tools)) {
      project.tools[tool] = (project.tools[tool] || 0) + count
      tools[tool] = (tools[tool] || 0) + count
    }
    sessionRows.push({
      sessionId: summary.sessionId,
      name: live.get(summary.sessionId)?.name || summary.title || summary.project,
      project: summary.project,
      branch: summary.branch,
      model: summary.model,
      tokens: total,
      tokenMix: summary.tokens,
      cost: summary.cost,
      prompts: summary.prompts,
      commits: summary.commits,
      subagents: summary.subagents,
      lastAt: summary.lastAt,
      isLive: live.has(summary.sessionId),
    })
  }
  sessionRows.sort((left, right) => right.tokens - left.tokens)

  const timelineIds = new Set([...live.keys()])
  for (const row of sessionRows) if (row.lastAt >= now - DAY_MS) timelineIds.add(row.sessionId)
  const timelineSince = now - DAY_MS
  const timeline = [...timelineIds].map(sessionId => {
    const summary = summaries.get(sessionId)
    const waits = statusSegments(sessionId, startOfToday, now).filter(segment => segment.status === 'waiting')
    return {
      sessionId,
      name: live.get(sessionId)?.name || summary?.title || summary?.project || sessionId.slice(0, 8),
      isLive: live.has(sessionId),
      active: activitySegments(sessionId, timelineSince),
      status: statusSegments(sessionId, timelineSince, now),
      waitedTodayMs: waits.reduce((sum, segment) => sum + (segment.end - segment.start), 0),
    }
  })
  timeline.sort((left, right) => Number(right.isLive) - Number(left.isLive) || left.name.localeCompare(right.name))

  return {
    range,
    generatedAt: now,
    transcriptsReadyAt,
    statusLogSince: statusLog[0]?.t || now,
    totals,
    days: dayList.map(day => ({ day, byModel: perDay[day] })),
    models: [...models].sort(),
    pricingModels: Object.keys(pricing.models || {}),
    projects: Object.values(projects)
      .map(project => ({
        ...project,
        files: project.files.size,
        branches: [...project.branches],
        topTools: Object.entries(project.tools)
          .sort((left, right) => right[1] - left[1])
          .slice(0, 4)
          .map(([tool, count]) => ({ tool, count })),
        tools: undefined,
      }))
      .sort((left, right) => right.cost - left.cost),
    tools: Object.entries(tools)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 14)
      .map(([tool, count]) => ({ tool, count })),
    sessions: sessionRows,
    timeline,
  }
}

// Without the session's own report, the window is the model's: these run with 1M tokens.
const MILLION_TOKEN_MODELS = /^claude-(fable-5|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6|haiku-5)/

function contextWindowFor(model) {
  return MILLION_TOKEN_MODELS.test(baseModel(model)) ? 1_000_000 : 200_000
}

// Subagents a session spawned: each writes <session>/subagents/agent-<id>.jsonl
// beside a .meta.json naming its type and description and, once done, finished.
const metaCache = new Map() // path -> { mtimeMs, meta }
const SUBAGENT_STALE_MS = 15 * 60 * 1000

// Subagent files by session, rebuilt only when a transcript scan changed the set.
let subagentIndex = { version: -1, bySession: new Map() }
function subagentFilesOf(sessionId) {
  if (subagentIndex.version !== filesVersion) {
    const bySession = new Map()
    for (const state of files.values()) {
      if (!state.isSubagent) continue
      if (!bySession.has(state.sessionId)) bySession.set(state.sessionId, [])
      bySession.get(state.sessionId).push(state)
    }
    subagentIndex = { version: filesVersion, bySession }
  }
  return subagentIndex.bySession.get(sessionId) || []
}

// The background shells a session still has running, with the end of their output.
const SHELL_OUTPUT = /^\/(private\/)?tmp\/claude-[^/]+\/.+\/tasks\/[\w-]+\.output$/
let mainFileIndex = { version: -1, bySession: new Map() }
function shellsOf(session, now) {
  if (mainFileIndex.version !== filesVersion) {
    const bySession = new Map()
    for (const state of files.values()) if (!state.isSubagent) bySession.set(state.sessionId, state)
    mainFileIndex = { version: filesVersion, bySession }
  }
  const state = mainFileIndex.bySession.get(session.sessionId)
  if (!state?.shells?.size) return []
  // A shell from before this process started (the session was resumed) died with the old one.
  const since = (session.startedAt || 0) - 10_000
  const found = []
  for (const shell of state.shells.values()) {
    if (shell.endedAt || shell.startedAt < since || now - shell.startedAt > DAY_MS) continue
    found.push({ id: shell.id, command: shell.command, description: shell.description, startedAt: shell.startedAt, ...outputTail(shell.outputFile) })
  }
  return found.sort((left, right) => left.startedAt - right.startedAt)
}
function outputTail(file) {
  if (!file || !SHELL_OUTPUT.test(file)) return { lastOutput: '', outputAt: 0 }
  try {
    const stat = fs.statSync(file)
    const length = Math.min(stat.size, 4096)
    const buffer = Buffer.alloc(length)
    const handle = fs.openSync(file, 'r')
    try { fs.readSync(handle, buffer, 0, length, stat.size - length) } finally { fs.closeSync(handle) }
    const lines = buffer.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean)
    return { lastOutput: (lines[lines.length - 1] || '').slice(0, 240), outputAt: stat.mtimeMs }
  } catch {
    return { lastOutput: '', outputAt: 0 }
  }
}

function subagentsOf(sessionId, now) {
  const found = []
  for (const state of subagentFilesOf(sessionId)) {
    let stat
    try {
      stat = fs.statSync(state.filePath)
    } catch {
      continue
    }
    const metaPath = state.filePath.replace(/\.jsonl$/, '.meta.json')
    let meta = {}
    try {
      const metaStat = fs.statSync(metaPath)
      const cached = metaCache.get(metaPath)
      if (cached && cached.mtimeMs === metaStat.mtimeMs) meta = cached.meta
      else {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
        metaCache.set(metaPath, { mtimeMs: metaStat.mtimeMs, meta })
      }
    } catch {}
    const isRunning = meta.finished !== true && now - stat.mtimeMs < SUBAGENT_STALE_MS
    // A subagent leaves the page as soon as it finishes.
    if (!isRunning) continue
    found.push({
      agentId: baseName(state.filePath).replace(/^agent-|\.jsonl$/g, ''),
      description: String(meta.description || state.firstPrompt || 'subagent').slice(0, 120),
      agentType: String(meta.agentType || ''),
      model: String(meta.model || state.model || ''),
      isBackground: meta.requestShape === 'background',
      isRunning,
      startedAt: state.firstAt,
      lastAt: stat.mtimeMs,
    })
  }
  return found.sort((left, right) => Number(right.isRunning) - Number(left.isRunning) || right.lastAt - left.lastAt)
}

// A name Claude Code derived from the folder (my-app-9b) says nothing:
// the session's own agent name, then its title, then its first prompt say more.
function displayName(session, summary) {
  if (session.nameSource !== 'derived') return session.name
  const fromPrompt = summary?.firstPrompt
    ? summary.firstPrompt.split(/\s+/).slice(0, 8).join(' ').slice(0, 56) + (summary.firstPrompt.length > 56 ? '…' : '')
    : ''
  return summary?.agentName || summary?.title || fromPrompt || session.name
}

// Each open dashboard asks every 2 seconds: one answer serves them all for a second.
let liveCache = { at: 0, view: null }
function liveView() {
  if (liveCache.view && Date.now() - liveCache.at < 1000) return liveCache.view
  liveCache = { at: Date.now(), view: buildLiveView() }
  return liveCache.view
}

function buildLiveView() {
  const now = Date.now()
  const today = dayKey(now)
  const summaries = sessionSummaries(today)
  const rateLimits = new Map()
  const sessions = [...live.values()].map(session => {
    const beat = heartbeats.get(session.sessionId)
    const hasMod = Boolean(beat && now - beat.at < HEARTBEAT_FRESH_MS)
    const summary = summaries.get(session.sessionId)
    let contextTokens = summary?.contextTokens || 0
    let contextWindow = Math.max(contextWindowFor(summary?.model), contextTokens > 200_000 ? 1_000_000 : 0)
    let model = summary?.model || ''
    if (hasMod) {
      model = baseModel(beat.model) || model
      if (beat.context?.tokens != null) contextTokens = beat.context.tokens
      if (beat.context?.window) contextWindow = beat.context.window
      for (const limit of beat.rateLimits || []) {
        const known = rateLimits.get(limit.kind)
        if (!known || (beat.at > known.at)) rateLimits.set(limit.kind, { ...limit, at: beat.at })
      }
    }
    const topTools = Object.entries(summary?.tools || {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, 5)
      .map(([tool, count]) => ({ tool, count }))
    const filesTouched = Object.entries(summary?.filesTouched || {})
      .sort((left, right) => right[1] - left[1])
      .slice(0, 8)
      .map(([file, count]) => ({ file, count }))
    return {
      ...session,
      name: displayName(session, summary),
      registryName: session.name,
      hasMod,
      model,
      contextTokens,
      contextWindow,
      contextPercent: contextWindow ? Math.min(100, Math.round((contextTokens / contextWindow) * 100)) : 0,
      sessionCostUsd: hasMod ? beat.costUsd ?? null : null,
      turns: hasMod ? beat.turns ?? null : null,
      todayTokens: summary
        ? summary.tokens.input + summary.tokens.output + summary.tokens.cacheRead + summary.tokens.cacheWrite5m + summary.tokens.cacheWrite1h
        : 0,
      todayCost: summary?.cost || 0,
      lastPrompt: summary?.lastPrompt || '',
      lastPromptAt: summary?.lastPromptAt || 0,
      lastReply: summary?.lastReply || '',
      lastReplyAt: summary?.lastReplyAt || 0,
      lastTool: summary?.lastTool || '',
      lastToolAt: summary?.lastToolAt || 0,
      prompts: summary?.prompts || 0,
      commits: summary?.commits || 0,
      pushes: summary?.pushes || 0,
      topTools,
      filesTouched,
      lastActivityAt: Math.max(summary?.lastAt || 0, session.updatedAt || 0),
      subagents: subagentsOf(session.sessionId, now),
      shells: shellsOf(session, now),
      asks: pendingAsks(session.sessionId),
      subagentCount: summary?.subagents || 0,
    }
  })
  // A question waiting on the page is the session waiting for you, whatever its registry says.
  for (const session of sessions) {
    if (!session.asks.length) continue
    session.status = 'waiting'
    session.waitingFor = session.asks[0].kind === 'question' ? 'a question for you' : `permission for ${session.asks[0].toolName}`
  }
  const rank = { waiting: 0, busy: 1, shell: 2, idle: 3 }
  sessions.sort(
    (left, right) => (rank[left.status] ?? 9) - (rank[right.status] ?? 9) || right.lastActivityAt - left.lastActivityAt,
  )
  return {
    generatedAt: now,
    sessions,
    rateLimits: [...rateLimits.values()],
    deliveries: deliveries.slice(-20),
  }
}

// ------------------------------------------------------------- questions --

// A hidden session has no terminal to ask in. The Fleet mod sends its permission
// prompts and questions here; the page shows them in the session's chat with
// buttons; the mod long-polls /api/asks/wait and hands the answer to the session.
const asks = new Map() // id -> { id, sessionId, kind, toolName, toolInput, suggestions, questions, createdAt, answer }
const askWaiters = new Map() // id -> Set of resolve(answer)
const ASK_WAIT_MS = 25_000
const ASK_TTL_MS = 12 * 60 * 60 * 1000

function boundedInput(value) {
  try {
    const text = JSON.stringify(value ?? {})
    return text.length <= 20_000 ? JSON.parse(text) : { truncated: text.slice(0, 20_000) }
  } catch {
    return {}
  }
}
function cleanQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).slice(0, 4).map(question => ({
    question: String(question?.question || '').slice(0, 1000),
    header: String(question?.header || '').slice(0, 40),
    multiSelect: question?.multiSelect === true,
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, 6).map(option => ({
      label: String(option?.label || '').slice(0, 200),
      description: String(option?.description || '').slice(0, 600),
    })),
  })).filter(question => question.question)
}
function createAsk(body) {
  const sessionId = String(body.sessionId || '')
  if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'Not a session id.' }
  const kind = body.kind === 'question' ? 'question' : 'permission'
  const id = crypto.randomUUID()
  asks.set(id, {
    id,
    sessionId,
    kind,
    toolName: cleanLine(body.toolName, 80) || (kind === 'question' ? 'AskUserQuestion' : 'a tool'),
    toolInput: kind === 'permission' ? boundedInput(body.toolInput) : {},
    suggestions: Array.isArray(body.suggestions) ? boundedInput(body.suggestions.slice(0, 6)) : [],
    questions: kind === 'question' ? cleanQuestions(body.questions) : [],
    reason: cleanLine(body.reason, 300),
    createdAt: Date.now(),
    answer: null,
  })
  liveCache.at = 0
  log('ask', kind, sessionId.slice(0, 8), body.toolName || '')
  return { ok: true, id }
}
function pendingAsks(sessionId) {
  const found = []
  for (const ask of asks.values()) {
    if (ask.sessionId !== sessionId || ask.answer) continue
    found.push({ id: ask.id, kind: ask.kind, toolName: ask.toolName, toolInput: ask.toolInput, reason: ask.reason, questions: ask.questions, createdAt: ask.createdAt })
  }
  return found.sort((left, right) => left.createdAt - right.createdAt)
}
function waitForAnswer(id) {
  const ask = asks.get(id)
  if (!ask) return Promise.resolve({ status: 'gone' })
  if (ask.answer) return Promise.resolve({ status: 'answered', answer: ask.answer })
  return new Promise(resolve => {
    const waiters = askWaiters.get(id) || new Set()
    askWaiters.set(id, waiters)
    const done = result => { clearTimeout(timer); waiters.delete(done); resolve(result) }
    const timer = setTimeout(() => done({ status: 'pending' }), ASK_WAIT_MS)
    waiters.add(done)
  })
}
function answerAsk(body) {
  const ask = asks.get(String(body.id || ''))
  if (!ask) return { ok: false, reason: 'That question is no longer open.' }
  if (ask.answer) return { ok: false, reason: 'It was already answered.' }
  const given = body.answer || {}
  if (ask.kind === 'permission') {
    ask.answer = { allow: given.allow === true, remember: given.allow === true && given.remember === true, message: cleanLine(given.message, 500) }
  } else {
    const answers = {}
    for (const question of ask.questions) {
      const value = given.answers?.[question.question]
      if (typeof value === 'string' && value.trim()) answers[question.question] = value.trim().slice(0, 2000)
    }
    const response = String(given.response || '').trim().slice(0, 4000)
    if (!Object.keys(answers).length && !response) return { ok: false, reason: 'Pick an answer first.' }
    ask.answer = { answers, response }
  }
  for (const done of askWaiters.get(ask.id) || []) done({ status: 'answered', answer: ask.answer })
  askWaiters.delete(ask.id)
  liveCache.at = 0
  // Kept a minute, so a mod that was between polls still collects it.
  setTimeout(() => asks.delete(ask.id), 60_000)
  return { ok: true }
}
function cancelAsk(body) {
  const ask = asks.get(String(body.id || ''))
  if (ask && !ask.answer) asks.delete(ask.id)
  for (const done of askWaiters.get(String(body.id || '')) || []) done({ status: 'gone' })
  askWaiters.delete(String(body.id || ''))
  liveCache.at = 0
  return { ok: true }
}
function sweepAsks(now = Date.now()) {
  for (const ask of asks.values()) {
    if (!live.has(ask.sessionId) || now - ask.createdAt > ASK_TTL_MS) cancelAsk({ id: ask.id })
  }
}

// ------------------------------------------------------------------ screen --

// What a hidden session's terminal shows, from `claude logs <id>`: the raw
// output is replayed on a small grid so the page can draw the screen as text.
function renderScreen(raw, cols = 200, rows = 50) {
  const blank = () => ({ ch: ' ', fg: '', bold: false })
  let grid = Array.from({ length: rows }, () => Array.from({ length: cols }, blank))
  let row = 0, col = 0, fg = '', bold = false
  const clamp = () => { row = Math.max(0, Math.min(rows - 1, row)); col = Math.max(0, Math.min(cols - 1, col)) }
  const newline = () => { row++; if (row >= rows) { grid.shift(); grid.push(Array.from({ length: cols }, blank)); row = rows - 1 } }
  const text = String(raw)
  for (let index = 0; index < text.length; index++) {
    const ch = text[index]
    if (ch === '\x1b') {
      const next = text[index + 1]
      if (next === '[') {
        let end = index + 2
        while (end < text.length && !/[@-~]/.test(text[end])) end++
        const params = text.slice(index + 2, end).replace(/^\?/, '')
        const final = text[end]
        const numbers = params.split(';').map(part => Number(part) || 0)
        const first = numbers[0] || 0
        if (final === 'm') {
          for (let at = 0; at < numbers.length; at++) {
            const code = params ? numbers[at] : 0
            if (code === 0) { fg = ''; bold = false }
            else if (code === 1) bold = true
            else if (code === 22) bold = false
            else if (code === 39) fg = ''
            else if (code === 38 && numbers[at + 1] === 2) { fg = `rgb(${numbers[at + 2]},${numbers[at + 3]},${numbers[at + 4]})`; at += 4 }
            else if (code === 38 && numbers[at + 1] === 5) { at += 2 }
            else if (code === 48) { at += numbers[at + 1] === 2 ? 4 : 2 }
            else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) fg = ['#000', '#c33', '#3a3', '#c90', '#36c', '#c3c', '#3cc', '#ccc'][(code % 10)]
          }
        } else if (final === 'H' || final === 'f') { row = (numbers[0] || 1) - 1; col = (numbers[1] || 1) - 1; clamp() }
        else if (final === 'A') { row -= first || 1; clamp() }
        else if (final === 'B') { row += first || 1; clamp() }
        else if (final === 'C') { col += first || 1; clamp() }
        else if (final === 'D') { col -= first || 1; clamp() }
        else if (final === 'G') { col = (first || 1) - 1; clamp() }
        else if (final === 'd') { row = (first || 1) - 1; clamp() }
        else if (final === 'J') {
          if (first === 2 || first === 3) grid = Array.from({ length: rows }, () => Array.from({ length: cols }, blank))
          else if (first === 0) { for (let c = col; c < cols; c++) grid[row][c] = blank(); for (let r = row + 1; r < rows; r++) grid[r] = Array.from({ length: cols }, blank) }
        } else if (final === 'K') {
          const [from, to] = first === 1 ? [0, col + 1] : first === 2 ? [0, cols] : [col, cols]
          for (let c = from; c < to; c++) grid[row][c] = blank()
        }
        index = end
      } else if (next === ']') {
        // An OSC string ends at BEL or ESC \.
        let end = index + 2
        while (end < text.length && text[end] !== '\x07' && !(text[end] === '\x1b' && text[end + 1] === '\\')) end++
        index = text[end] === '\x07' ? end : end + 1
      } else index++
      continue
    }
    if (ch === '\r') { col = 0; continue }
    if (ch === '\n') { newline(); continue }
    if (ch === '\b') { col = Math.max(0, col - 1); continue }
    if (ch === '\t') { col = Math.min(cols - 1, (Math.floor(col / 8) + 1) * 8); continue }
    if (ch < ' ' || ch === '\x7f') continue
    if (col >= cols) { col = 0; newline() }
    grid[row][col] = { ch, fg, bold }
    col++
  }
  // Rows as runs of one style, trailing blanks dropped.
  const lines = grid.map(cells => {
    let last = cells.length - 1
    while (last >= 0 && cells[last].ch === ' ') last--
    const runs = []
    for (let c = 0; c <= last; c++) {
      const cell = cells[c], run = runs[runs.length - 1]
      if (run && run.fg === cell.fg && run.bold === cell.bold) run.text += cell.ch
      else runs.push({ text: cell.ch, fg: cell.fg, bold: cell.bold })
    }
    return runs
  })
  while (lines.length && !lines[lines.length - 1].length) lines.pop()
  return lines
}
async function hiddenScreen(sessionId) {
  const session = live.get(sessionId)
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  if (!session.hidden) return { ok: false, reason: 'Only a hidden session shows its screen here.' }
  const result = await run(claudeBinary(), ['logs', session.jobId], { timeout: 8000, maxBuffer: 4 * 1024 * 1024 })
  if (result.code !== 0) return { ok: false, reason: stripAnsi(result.stderr || result.stdout).trim().split('\n')[0] || 'Its screen could not be read.' }
  return { ok: true, lines: renderScreen(result.stdout), at: Date.now() }
}

// ------------------------------------------------------------- messaging --

// The page queues a message here. A connected session's own fleet mod takes it
// as a prompt (or runs its /command); a session without the mod has it typed
// into its Terminal tab by this server once it is idle. Nothing is ever relayed
// through another session.
let inbox = [] // { id, sessionId, text, createdAt, claimedAt, claimedBy }
const deliveries = [] // { id, sessionId, name, text, at, isDelivered, reason, via }

function claimFor(claimant) {
  const now = Date.now()
  const claimed = []
  for (const item of inbox) {
    if (item.claimedAt && now - item.claimedAt < 30000) continue
    // Only the session a message is for takes it. Relaying through another
    // session made that session the sender, and the reply landed there.
    if (item.sessionId !== claimant) continue
    const mode = item.command ? 'command' : 'prompt'
    item.claimedAt = now
    item.claimedBy = claimant
    const text = mode === 'prompt' ? guardLeading(item.text) : item.text
    claimed.push({ id: item.id, sessionId: item.sessionId, text, mode, command: item.command, args: item.args })
  }
  return claimed
}

function acknowledge(id, result, removed) {
  liveCache.at = 0
  const index = inbox.findIndex(entry => entry.id === id)
  if (index < 0 && !removed) return
  const item = index >= 0 ? inbox.splice(index, 1)[0] : removed
  deliveries.push({
    id,
    sessionId: item.sessionId,
    name: live.get(item.sessionId)?.name || item.sessionId.slice(0, 8),
    text: item.text.slice(0, 200),
    at: Date.now(),
    isDelivered: Boolean(result.isDelivered),
    reason: String(result.reason || ''),
    via: result.mode === 'prompt' ? 'prompt' : result.mode === 'command' ? 'command' : result.mode === 'typed' ? 'typed into its tab' : 'message',
  })
  if (deliveries.length > 100) deliveries.splice(0, deliveries.length - 100)
}

// --------------------------------------------------------------- terminal --

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

// ------------------------------------------------------------- terminal --

// AppleScript calls against Terminal run one at a time: twenty sessions' worth
// of focus, typing and new windows never interleave.
let terminalQueue = Promise.resolve()
function inTerminalQueue(task) {
  const result = terminalQueue.then(task, task)
  terminalQueue = result.catch(() => {})
  return result
}
const osascript = (...args) => inTerminalQueue(() => run('osascript', ['-e', ...args]))

// --------------------------------------------------------- new sessions --

const MODELS = [
  { id: '', label: 'Default (your settings)' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
]
const MODEL_IDS = new Set(MODELS.map(model => model.id).filter(Boolean))

// What a home folder holds besides projects, left out of the folder pickers.
const SYSTEM_FOLDERS = new Set(['Applications', 'Library', 'Movies', 'Music', 'Pictures', 'Public', 'Desktop', 'Downloads'])

async function listFolders() {
  let entries = []
  try {
    entries = await fsp.readdir(newSessionRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const folders = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SYSTEM_FOLDERS.has(entry.name)) continue
    const full = path.join(newSessionRoot, entry.name)
    if (isExcludedPath(full)) continue
    folders.push({ name: entry.name, path: full, isGit: fs.existsSync(path.join(full, '.git')) })
  }
  return folders.sort((left, right) => left.name.localeCompare(right.name))
}

function shellQuote(text) {
  return `'${String(text).replace(/'/g, `'\\''`)}'`
}

// A session name or a command argument: one line of printable text.
function cleanLine(text, max) {
  return String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

// Terminal has no command for a new tab, so with a window already open it
// presses ⌘T and waits for the tab to appear. Pressing keys needs the
// Accessibility permission; without it the session opens in a new window
// and the answer says why. Answers "tab", "window" or "window-no-access".
const OPEN_IN_TERMINAL = `on run argv
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

const OPEN_IN_ITERM = `on run argv
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

const IS_RUNNING = `on run argv
  if application (item 1 of argv) is running then return "yes"
  return "no"
end run`

// New windows open in the terminal you use: Terminal if it is open, else
// iTerm2 if that is, else Terminal.
// A new session opens as a tab in the front window when it can, else in a new window.
async function openInTerminal(command) {
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

// -------------------------------------------------------- folder browser --

// Any folder under the home folder can be browsed and picked, followed through
// links to where it really is; nothing outside home, nothing excluded.
function insideHome(target) {
  // realpath('') is the working directory: an empty path picks nothing.
  if (!target) return ''
  try {
    const real = fs.realpathSync(String(target || ''))
    const home = fs.realpathSync(HOME)
    if (real !== home && !real.startsWith(home + '/')) return ''
    return fs.statSync(real).isDirectory() ? real : ''
  } catch {
    return ''
  }
}

const SKIPPED_FOLDERS = new Set(['node_modules', '__pycache__', 'dist', 'build', '.git'])

async function browse(target) {
  const home = fs.realpathSync(HOME)
  const real = insideHome(target) || insideHome(newSessionRoot) || home
  if (isExcludedPath(real)) return { ok: false, reason: 'That folder is excluded from the fleet.' }
  let entries = []
  try {
    entries = await fsp.readdir(real, { withFileTypes: true })
  } catch {
    return { ok: false, reason: 'That folder cannot be read.' }
  }
  const folders = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name)) continue
    if (real === home && SYSTEM_FOLDERS.has(entry.name)) continue
    const full = path.join(real, entry.name)
    const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && Boolean(insideHome(full)))
    if (!isDirectory || isExcludedPath(full)) continue
    folders.push({ name: entry.name, path: full, isGit: fs.existsSync(path.join(full, '.git')) })
    if (folders.length >= 400) break
  }
  folders.sort((left, right) => Number(right.isGit) - Number(left.isGit) || left.name.localeCompare(right.name))
  const crumbs = [{ name: 'Home', path: home }]
  let walked = home
  for (const part of path.relative(home, real).split(path.sep).filter(Boolean)) {
    walked = path.join(walked, part)
    crumbs.push({ name: part, path: walked })
  }
  return { ok: true, path: real, isGit: fs.existsSync(path.join(real, '.git')), crumbs, folders }
}

// ------------------------------------------------------- hidden sessions --

// A hidden session runs in Claude Code's own background service (`claude --bg`):
// no terminal window opens, and the dashboard is how it is reached. `claude
// attach <id>` opens it in a terminal at any time; `claude stop <id>` ends it.
function claudeBinary() {
  for (const candidate of [path.join(HOME, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (fs.existsSync(candidate)) return candidate
  }
  return 'claude'
}
const stripAnsi = text => String(text).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
async function startHidden(cwd, args) {
  const result = await run(claudeBinary(), ['--bg', ...args], { cwd, timeout: 60000 })
  const output = stripAnsi(result.stdout + '\n' + result.stderr)
  const jobId = output.match(/backgrounded\s*·\s*([0-9a-f]{6,})/i)?.[1]
  if (result.code === 0 && jobId) {
    setTimeout(() => void scanRegistry(), 1500)
    return { ok: true, where: 'hidden', jobId }
  }
  const reason = output.split('\n').map(line => line.trim()).filter(line => line && !/^Starting background/i.test(line))[0]
  return { ok: false, reason: reason || 'The hidden session did not start.' }
}
async function attachHidden(sessionId) {
  const session = live.get(sessionId)
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  if (!session.hidden) return focusTab(sessionId)
  return openInTerminal(`${shellQuote(claudeBinary())} attach ${shellQuote(session.jobId)}`)
}

async function startSession(body) {
  const folderPath = insideHome(body.folder)
  if (!folderPath || isExcludedPath(folderPath)) return { ok: false, reason: 'Pick a folder inside your home folder.' }
  const folder = { path: folderPath }
  const model = String(body.model || '')
  if (model && !MODEL_IDS.has(model)) return { ok: false, reason: 'Unknown model.' }
  const name = cleanLine(body.name, 80)
  const command = [
    `cd ${shellQuote(folder.path)} &&`,
    'claude',
    model ? `--model ${shellQuote(model)}` : '',
    name ? `--name ${shellQuote(name)}` : '',
  ].filter(Boolean).join(' ')
  if (body.hidden === true) return startHidden(folder.path, [...(model ? ['--model', model] : []), ...(name ? ['--name', name] : [])])
  return openInTerminal(command)
}

const TYPE_INTO_ITERM = `on run argv
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
      const box = inputBoxText((await osascript(reader, `/dev/${tty}`)).stdout)
      if (box === null || !(box.includes(opening) || box.includes('[Pasted text'))) return { ok: true, script }
      waitMs = 2000
    }
    return { ok: false, reason: 'it is still in its input box: press Enter in its tab' }
  }
  return { ok: false, reason: 'its Terminal or iTerm2 tab was not found' }
}
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

// What sits in Claude Code's input box: the lines between the last two rules
// drawn across the screen. null when the screen does not show one.
function inputBoxText(screen) {
  const lines = String(screen || '').trimEnd().split('\n')
  const rules = []
  for (let index = lines.length - 1; index >= 0 && rules.length < 2; index--) if (/^\s*─{20,}/.test(lines[index])) rules.push(index)
  return rules.length < 2 ? null : lines.slice(rules[1] + 1, rules[0]).join('\n')
}

const TYPE_INTO_TAB = `on run argv
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

// /model and /rename: a connected session runs them itself; any other session
// has them typed into its tab, which only works while it waits at an empty prompt.
// ------------------------------------------------------ resuming sessions --

const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function readSlice(filePath, start, length) {
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

// What a past session was about, from the head and tail of its transcript: no
// need to read a 20 MB file to name it.
async function describeTranscript(filePath, size) {
  const head = await readSlice(filePath, 0, Math.min(size, 256 * 1024))
  const tail = size > 256 * 1024 ? await readSlice(filePath, size - 128 * 1024, 128 * 1024) : ''
  const facts = { cwd: '', agentName: '', title: '', firstPrompt: '', lastPrompt: '', prompts: 0, model: '' }
  const readLines = (text, isTail) => {
    const lines = text.split('\n')
    if (isTail) lines.shift()
    for (const line of lines) {
      if (!line || line[0] !== '{') continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (row.cwd && !facts.cwd) facts.cwd = row.cwd
      if (row.type === 'agent-name' && row.agentName) facts.agentName = String(row.agentName)
      if (row.type === 'custom-title' && row.customTitle) facts.title = String(row.customTitle)
      if (row.type === 'assistant' && row.message?.model && row.message.model !== '<synthetic>') facts.model = baseModel(row.message.model)
      const content = row.message?.content
      if (row.type === 'user' && !row.isMeta && typeof content === 'string') {
        const text = content.trim()
        if (!text || text.startsWith('<')) continue
        if (!facts.firstPrompt) facts.firstPrompt = text.slice(0, 200)
        facts.lastPrompt = text.slice(0, 300)
        if (!isTail) facts.prompts++
      }
    }
  }
  readLines(head, false)
  if (tail) readLines(tail, true)
  return facts
}

async function listHistory(folderPath) {
  const realFolder = insideHome(folderPath)
  if (!realFolder || isExcludedPath(realFolder)) return { ok: false, reason: 'Pick a folder inside your home folder.' }
  const folder = { path: realFolder }
  const slug = folder.path.replace(/[^a-zA-Z0-9]/g, '-')
  let projectDirs = []
  try {
    projectDirs = (await fsp.readdir(PROJECTS_DIR)).filter(name => name === slug || name.startsWith(slug + '-'))
  } catch {}
  const candidates = []
  for (const dir of projectDirs) {
    let names = []
    try {
      names = await fsp.readdir(path.join(PROJECTS_DIR, dir))
    } catch {
      continue
    }
    for (const name of names) {
      const sessionId = name.replace(/\.jsonl$/, '')
      if (!name.endsWith('.jsonl') || !SESSION_ID_PATTERN.test(sessionId)) continue
      try {
        const full = path.join(PROJECTS_DIR, dir, name)
        const stat = await fsp.stat(full)
        if (stat.size > 0) candidates.push({ sessionId, full, size: stat.size, lastAt: stat.mtimeMs })
      } catch {}
    }
  }
  candidates.sort((left, right) => right.lastAt - left.lastAt)
  const liveIds = new Set(live.keys())
  const sessions = []
  for (const candidate of candidates.slice(0, 60)) {
    const facts = await describeTranscript(candidate.full, candidate.size)
    // A slug also matches a sibling (api → api-docs): the rows' cwd decides.
    if (!facts.cwd || !(facts.cwd === folder.path || facts.cwd.startsWith(folder.path + '/'))) continue
    if (!facts.firstPrompt) continue
    sessions.push({
      sessionId: candidate.sessionId,
      name: facts.agentName || facts.title || facts.firstPrompt.split(/\s+/).slice(0, 10).join(' '),
      firstPrompt: facts.firstPrompt,
      lastPrompt: facts.lastPrompt,
      prompts: facts.prompts,
      model: facts.model,
      cwd: facts.cwd,
      subfolder: facts.cwd === folder.path ? '' : facts.cwd.slice(folder.path.length + 1),
      lastAt: candidate.lastAt,
      sizeBytes: candidate.size,
      isLive: liveIds.has(candidate.sessionId),
    })
    if (sessions.length >= 40) break
  }
  return { ok: true, sessions }
}

async function resumeSession(body) {
  const sessionId = String(body.sessionId || '')
  if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'Not a session id.' }
  if (live.has(sessionId)) return { ok: false, reason: live.get(sessionId).hidden ? 'That session is already running hidden: open it from its row.' : 'That session is already running: use Open tab.' }
  const model = String(body.model || '')
  if (model && !MODEL_IDS.has(model)) return { ok: false, reason: 'Unknown model.' }
  let found = ''
  for (const dir of await fsp.readdir(PROJECTS_DIR).catch(() => [])) {
    const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(candidate)) {
      found = candidate
      break
    }
  }
  if (!found) return { ok: false, reason: 'Its transcript was not found.' }
  const facts = await describeTranscript(found, (await fsp.stat(found)).size)
  if (!facts.cwd || !fs.existsSync(facts.cwd)) return { ok: false, reason: `Its folder is gone: ${facts.cwd || 'unknown'}` }
  if (isExcludedPath(facts.cwd)) return { ok: false, reason: 'That folder is excluded from the fleet.' }
  const command = [`cd ${shellQuote(facts.cwd)} &&`, 'claude', `--resume ${sessionId}`, model ? `--model ${shellQuote(model)}` : '']
    .filter(Boolean)
    .join(' ')
  if (body.hidden === true) return startHidden(facts.cwd, ['--resume', sessionId, ...(model ? ['--model', model] : [])])
  return openInTerminal(command)
}

async function runSessionCommand(body) {
  const session = live.get(String(body.sessionId || ''))
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  const command = String(body.command || '')
  let args = ''
  if (command === 'model') {
    args = String(body.args || '')
    if (!MODEL_IDS.has(args)) return { ok: false, reason: 'Unknown model.' }
  } else if (command === 'rename') {
    args = cleanLine(body.args, 80)
    if (!args) return { ok: false, reason: 'Give it a name.' }
  } else if (command === 'compact') {
    // Optional: what the summary should keep, as /compact takes it.
    args = cleanLine(body.args, 500)
  } else return { ok: false, reason: 'Only /model, /rename and /compact can be sent.' }

  inbox.push({ id: crypto.randomUUID(), sessionId: session.sessionId, text: `/${command}${args ? ' ' + args : ''}`, command, args, createdAt: Date.now(), claimedAt: 0, claimedBy: '' })
  if (command === 'model') void answerModelQuestion(session.sessionId, args)
  return { ok: true, via: hasMod(session.sessionId) ? 'command' : 'typed' }
}

// /model asks "Switch model?" in the terminal when the conversation is cached
// for the current model. The person already confirmed the switch in the
// dashboard, which showed the same warning, so once that question is on screen
// in the session's tab, offering exactly this model, Return picks its "Yes".
// Nothing is pressed unless the question is there.
const READ_TERMINAL_TAB = `on run argv
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
const READ_ITERM_TAB = `on run argv
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
// /model also saves the model as the default for new sessions. A switch from
// the dashboard is for that one session, so the saved default is put back as
// it was (only its "model" key; the rest of the file is left as it is).
const USER_SETTINGS = path.join(HOME, '.claude', 'settings.json')
function readDefaultModel() {
  try { return JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8')).model } catch { return undefined }
}
function restoreDefaultModel(model) {
  try {
    const settings = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8'))
    if (settings.model === model) return false
    if (model === undefined) delete settings.model
    else settings.model = model
    fs.writeFileSync(USER_SETTINGS, JSON.stringify(settings, null, 2) + '\n')
    return true
  } catch {
    return false
  }
}
const answering = new Set()
async function answerModelQuestion(sessionId, model) {
  if (answering.has(sessionId)) return
  answering.add(sessionId)
  const label = MODELS.find(option => option.id === model)?.label || model
  const defaultBefore = readDefaultModel()
  const deadline = Date.now() + MESSAGE_TTL_MS
  let isAnswered = false, isRestored = false, quietPolls = 0
  try {
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      if (readDefaultModel() !== defaultBefore) isRestored = restoreDefaultModel(defaultBefore) || isRestored
      if (isRestored) return
      // Switched without saving a default (or not yet saved): give it a few polls.
      const session = live.get(sessionId)
      if (!session) return
      if (baseModel(heartbeats.get(sessionId)?.model) === model && ++quietPolls > 3) return
      if (isAnswered || !session.tty) continue
      for (const [reader, typer] of [[READ_TERMINAL_TAB, TYPE_INTO_TAB], [READ_ITERM_TAB, TYPE_INTO_ITERM]]) {
        const screen = (await osascript(reader, `/dev/${session.tty}`)).stdout
        const lastLines = screen.trimEnd().split('\n').slice(-12).join('\n')
        if (lastLines.includes('Switch model?') && new RegExp(`❯\\s*1\\.\\s*Yes, switch to ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lastLines)) {
          await osascript(typer, `/dev/${session.tty}`, '\r')
          isAnswered = true
          break
        }
      }
    }
  } finally {
    answering.delete(sessionId)
  }
}

function hasMod(sessionId) {
  const beat = heartbeats.get(sessionId)
  return Boolean(beat && Date.now() - beat.at < HEARTBEAT_FRESH_MS)
}

// What is typed must stay one prompt: Claude Code reads backslash-Enter as a
// new line, and a leading / or ! would run a command or a shell line instead.
function asTypedPrompt(text) {
  return guardLeading(stripControls(text))
}

// Escape, Ctrl-C, Ctrl-D and the like would act on the terminal, not be read.
function stripControls(text) {
  return String(text).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
}

// A leading / or ! would run a command or a shell line instead of being read.
function guardLeading(text) {
  return /^[\/!]/.test(text) ? ' ' + text : text
}

// Typing is only safe while Claude itself is in the foreground of that tab: if
// the person quit it, the text would land in the shell and run there.
async function claudeHasForeground(tty) {
  const listing = await run('ps', ['-t', tty, '-o', 'stat=,comm='])
  return listing.stdout.split('\n').some(line => {
    const [stat, ...command] = line.trim().split(/\s+/)
    return stat && stat.includes('+') && /(^|\/)claude$/.test(command.join(' '))
  })
}

const MESSAGE_TTL_MS = 10 * 60 * 1000
let isTyping = false

// Messages for sessions without the mod: typed into each one's own tab, one
// session at a time, only while that session waits idle at its prompt.
async function deliverTyped() {
  if (isTyping) return
  isTyping = true
  try {
    const now = Date.now()
    const handled = new Set()
    for (const item of [...inbox]) {
      if (handled.has(item.sessionId)) continue
      if (item.claimedAt && now - item.claimedAt < 30000) continue
      const session = live.get(item.sessionId)
      const fail = reason => {
        inbox = inbox.filter(other => other.id !== item.id)
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
      inbox = inbox.filter(other => other.id !== item.id)
      acknowledge(item.id, { isDelivered: typed.ok, reason: typed.ok ? '' : typed.reason, mode: 'typed' }, item)
      // It is busy now: the next message for it waits for the next idle.
      session.status = 'busy'
    }
  } finally {
    isTyping = false
  }
}

// ------------------------------------------------------- ending sessions --

// A process that exited but was not yet reaped by its parent (a zombie) still
// answers signal 0: ps's state says whether it really runs.
async function isAlive(pid) {
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  const state = (await run('ps', ['-o', 'stat=', '-p', String(pid)])).stdout.trim()
  return Boolean(state) && !state.startsWith('Z')
}

// SIGTERM lets Claude Code finish writing its transcript, so the session can be
// resumed later; `force` (SIGKILL) is for one that did not stop. The pid is
// checked to still be a claude process, never just any pid the page names.
// Closing the tab of an ended session: only when nothing but a shell is left on
// it, so a tab still running something else (a server, an editor) stays open.
// The shell is asked to exit first, which closes the tab without taking focus
// when Terminal closes tabs whose shell exits; else the tab is closed directly.
const SHELLS = /^-?(zsh|bash|fish|sh|login|tcsh|ksh)$/
async function onlyShellsOn(tty) {
  const listing = await run('ps', ['-t', tty, '-o', 'comm='])
  return listing.stdout.split('\n').map(line => baseName(line.trim())).filter(Boolean).every(name => SHELLS.test(name))
}
const EXIT_TERMINAL_SHELL = `on run argv
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
const TERMINAL_TAB_EXISTS = `on run argv
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
const CLOSE_TERMINAL_TAB = `on run argv
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
const CLOSE_ITERM_SESSION = `on run argv
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

async function endSession(body) {
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

async function focusTab(sessionId) {
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

// ------------------------------------------------------------------- http --

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

// The page may load Chart.js (pinned, with its integrity hash) and nothing else
// from outside, and may not be framed by another site.
const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

function send(response, status, body, type = 'application/json', extra = {}) {
  response.writeHead(status, {
    'content-type': type,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': PAGE_POLICY,
    ...extra,
  })
  response.end(type === 'application/json' ? JSON.stringify(body) : body)
}

// The page is read once and again only when the file changes, so a plugin
// update that removes the old folder never leaves this server unable to serve it.
let pageCache = { mtimeMs: 0, html: '' }
async function readPage() {
  try {
    const stat = await fsp.stat(PAGE_FILE)
    if (stat.mtimeMs !== pageCache.mtimeMs) pageCache = { mtimeMs: stat.mtimeMs, html: await fsp.readFile(PAGE_FILE, 'utf8') }
  } catch {}
  return pageCache.html
}

// Signing the browser in: a session's mod (which holds TOKEN) asks for a code
// good once for a minute, opens /auth?code=…, and the answer is an HttpOnly,
// SameSite=Strict cookie. Another account on this Mac, or a page elsewhere,
// gets nothing from loading the dashboard.
const loginCodes = new Map() // code -> expiry
function newLoginCode() {
  const now = Date.now()
  for (const [code, expiry] of loginCodes) if (expiry < now) loginCodes.delete(code)
  const code = crypto.randomBytes(18).toString('hex')
  loginCodes.set(code, now + 60000)
  return code
}
function takeLoginCode(code) {
  const expiry = loginCodes.get(code)
  loginCodes.delete(code)
  return Boolean(expiry && expiry >= Date.now())
}
const COOKIE_NAME = `fleet_${PORT}`

function safeEqual(given, expected) {
  return Boolean(expected) && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
function cookieValue(request) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return rest.join('=')
  }
  return ''
}
function hasToken(request) {
  return safeEqual(String(request.headers['x-fleet-token'] || ''), TOKEN)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    request.on('data', chunk => {
      size += chunk.length
      if (size > 256 * 1024) {
        reject(new Error('too large'))
        request.destroy()
      } else chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

// A session's mod sends the token; the browser sends its cookie, and for
// anything that acts, a header no other site can make a browser send.
function isAuthorized(request) {
  if (hasToken(request)) return true
  if (!safeEqual(cookieValue(request), BROWSER_SECRET)) return false
  return request.method === 'GET' || request.headers['x-fleet-request'] === '1'
}

const server = http.createServer(async (request, response) => {
  // A page on another origin, or a rebound DNS name, never gets in.
  if (!ALLOWED_HOSTS.has(String(request.headers.host || ''))) return send(response, 421, { error: 'wrong host' })
  const url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`)
  try {
    if (request.method === 'GET' && url.pathname === '/') {
      return send(response, 200, await readPage(), 'text/html; charset=utf-8')
    }
    if (request.method === 'GET' && url.pathname === '/auth') {
      if (!takeLoginCode(url.searchParams.get('code') || '')) return send(response, 302, '', 'text/plain', { location: '/?signin=expired' })
      return send(response, 302, '', 'text/plain', {
        location: '/',
        'set-cookie': `${COOKIE_NAME}=${BROWSER_SECRET}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      })
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return send(response, 200, { ok: true, pid: process.pid, port: PORT, version: VERSION, script: fileURLToPath(import.meta.url) })
    }
    if (!url.pathname.startsWith('/api/')) return send(response, 404, { error: 'not found' })
    if (!isAuthorized(request)) return send(response, 401, { error: 'missing or wrong token' })

    if (request.method === 'GET' && url.pathname === '/api/live') return send(response, 200, liveView())
    if (request.method === 'GET' && url.pathname === '/api/report') {
      return send(response, 200, buildReport(url.searchParams.get('range') === 'today' ? 'today' : '7d'))
    }
    if (request.method === 'GET' && url.pathname === '/api/browse') {
      return send(response, 200, await browse(url.searchParams.get('path') || ''))
    }
    if (request.method === 'GET' && url.pathname === '/api/recently-closed') return send(response, 200, { sessions: listRecentlyClosed() })
    if (request.method === 'GET' && url.pathname === '/api/history') {
      return send(response, 200, await listHistory(url.searchParams.get('folder') || ''))
    }
    if (request.method === 'GET' && url.pathname === '/api/options') {
      return send(response, 200, { root: newSessionRoot, folders: await listFolders(), models: MODELS })
    }
    if (request.method === 'GET' && url.pathname === '/api/screen') return send(response, 200, await hiddenScreen(url.searchParams.get('sessionId') || ''))
    if (request.method === 'GET' && url.pathname === '/api/asks/mode') {
      const session = live.get(url.searchParams.get('sessionId') || '')
      if (session?.hidden && mainFileIndex.version !== filesVersion) shellsOf(session, Date.now())
      return send(response, 200, { hidden: Boolean(session?.hidden), permissionMode: (session && mainFileIndex.bySession.get(session.sessionId)?.permissionMode) || '' })
    }
    if (request.method === 'GET' && url.pathname === '/api/asks/wait') {
      if (!hasToken(request)) return send(response, 401, { error: 'only a session waits for answers' })
      return send(response, 200, await waitForAnswer(url.searchParams.get('id') || ''))
    }
    if (request.method === 'GET' && url.pathname === '/api/inbox') {
      const sessionId = url.searchParams.get('sessionId') || ''
      return send(response, 200, { messages: claimFor(sessionId) })
    }
    if (request.method !== 'POST') return send(response, 405, { error: 'method' })
    const body = await readBody(request)

    if (url.pathname === '/api/login-code') {
      if (!hasToken(request)) return send(response, 401, { error: 'only a session can sign a browser in' })
      return send(response, 200, { code: newLoginCode() })
    }
    // A session running a newer version of the plugin retires this server.
    if (url.pathname === '/api/shutdown') {
      if (!hasToken(request)) return send(response, 401, { error: 'only a session can stop the server' })
      send(response, 200, { ok: true })
      log(`stopping for version ${String(body.version || '?')}`)
      setTimeout(() => process.exit(0), 200)
      return
    }
    if (url.pathname === '/api/heartbeat') {
      if (typeof body.sessionId !== 'string') return send(response, 400, { error: 'sessionId' })
      if (isExcludedPath(String(body.cwd || ''))) return send(response, 200, { ok: true, excluded: true })
      heartbeats.set(body.sessionId, {
        at: Date.now(),
        model: String(body.model || ''),
        context: body.context || null,
        costUsd: typeof body.costUsd === 'number' ? body.costUsd : null,
        turns: typeof body.turns === 'number' ? body.turns : null,
        rateLimits: Array.isArray(body.rateLimits) ? body.rateLimits.slice(0, 5) : [],
      })
      return send(response, 200, { ok: true })
    }
    if (url.pathname === '/api/focus') return send(response, 200, await focusTab(String(body.sessionId || '')))
    if (url.pathname === '/api/sessions') return send(response, 200, await startSession(body))
    if (url.pathname === '/api/command') return send(response, 200, await runSessionCommand(body))
    if (url.pathname === '/api/resume') return send(response, 200, await resumeSession(body))
    if (url.pathname === '/api/end') return send(response, 200, await endSession(body))
    if (url.pathname === '/api/attach') return send(response, 200, await attachHidden(String(body.sessionId || '')))
    if (url.pathname === '/api/asks') {
      if (!hasToken(request)) return send(response, 401, { error: 'only a session asks' })
      return send(response, 200, createAsk(body))
    }
    if (url.pathname === '/api/asks/cancel') {
      if (!hasToken(request)) return send(response, 401, { error: 'only a session cancels its question' })
      return send(response, 200, cancelAsk(body))
    }
    if (url.pathname === '/api/asks/answer') return send(response, 200, answerAsk(body))
    if (url.pathname === '/api/send') {
      const text = stripControls(String(body.text || '')).trim()
      const targets = Array.isArray(body.sessionIds) ? body.sessionIds.map(String) : []
      if (!text || !targets.length) return send(response, 400, { error: 'text and sessionIds are required' })
      if (text.length > 20000) return send(response, 400, { error: 'message too long' })
      const queued = targets
        .filter(sessionId => live.has(sessionId))
        .map(sessionId => {
          const item = { id: crypto.randomUUID(), sessionId, text, createdAt: Date.now(), claimedAt: 0, claimedBy: '' }
          inbox.push(item)
          return item.id
        })
      return send(response, 200, { queued: queued.length, ids: queued })
    }
    if (url.pathname === '/api/inbox/ack') {
      acknowledge(String(body.id || ''), body)
      return send(response, 200, { ok: true })
    }
    return send(response, 404, { error: 'not found' })
  } catch (error) {
    log('request failed', url.pathname, error.message)
    return send(response, 500, { error: 'server error' })
  }
})

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    // Another fleet server holds the port: it is the one, and its token stands.
    process.exit(0)
  }
  log('server error', error.message)
  process.exit(1)
})

fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
fs.chmodSync(DATA_DIR, 0o700)
TOKEN = loadSecret(TOKEN_FILE)
BROWSER_SECRET = loadSecret(BROWSER_SECRET_FILE)
server.listen(PORT, '127.0.0.1', () => {
  for (const file of ['server.log', 'status-log.jsonl', 'config.json', 'pricing.json']) {
    try {
      fs.chmodSync(path.join(DATA_DIR, file), 0o600)
    } catch {}
  }
  loadPricing()
  loadConfig()
  loadStatusLog()
  loadRecentlyClosed()
  log(`fleet listening on http://127.0.0.1:${PORT} (pid ${process.pid})`)

  const registryLoop = async () => {
    try {
      await scanRegistry()
      pruneMemory()
    } catch (error) {
      log('registry scan failed', error.message)
    }
    if (!live.size && Date.now() - lastSeenLiveAt > IDLE_EXIT_MS) {
      log('no Claude sessions for an hour; exiting')
      process.exit(0)
    }
    setTimeout(registryLoop, REGISTRY_POLL_MS)
  }
  const transcriptLoop = async () => {
    try {
      await scanTranscripts()
    } catch (error) {
      log('transcript scan failed', error.message)
    }
    setTimeout(transcriptLoop, TRANSCRIPT_POLL_MS)
  }
  // Typing into tabs runs on its own clock: a slow Terminal never holds up the scan.
  const typingLoop = async () => {
    try {
      await deliverTyped()
    } catch (error) {
      log('typing failed', error.message)
    }
    setTimeout(typingLoop, REGISTRY_POLL_MS)
  }
  registryLoop()
  transcriptLoop()
  typingLoop()
  fs.watchFile(PRICING_FILE, { interval: 5000 }, loadPricing)
  fs.watchFile(CONFIG_FILE, { interval: 5000 }, loadConfig)
})
