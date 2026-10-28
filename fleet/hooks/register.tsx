import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FleetSend, FleetSession } from '../types'

const PANE = 'fleet'
const REGISTRY_POLL_MS = 2000
const TRANSCRIPT_POLL_MS = 10000
const TRANSCRIPT_TAIL_BYTES = '400000'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const sessionsAtom = atom({ plugin: 'fleet', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
})
const lastSendAtom = atom({ plugin: 'fleet', key: 'lastSend' } as const, [], {
  shape: 'send-1',
})
const selectedAtom = atom({ plugin: 'fleet', key: 'selected' } as const, '')
const isOpenAtom = atom({ plugin: 'fleet', key: 'isOpen' } as const, false)
const scannedAtAtom = atom({ plugin: 'fleet', key: 'scannedAt' } as const, 0)

type Registration = {
  pid: number
  sessionId: string
  cwd: string
  name?: string
  status?: string
  waitingFor?: string
  updatedAt?: number
  startedAt?: number
  version?: string
}

type TranscriptFacts = {
  readAt: number
  model: string
  contextTokens: number
  lastPrompt: string
}

// Module memory: a reload starts these over, which costs one slow read.
const transcriptCache = new Map<string, TranscriptFacts>()
const branchCache = new Map<string, { readAt: number; branch: string }>()
const lastStatus = new Map<string, string>()
let isScanning = false

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

// Without the session's own report, the window is the model's: these run with 1M tokens.
const MILLION_TOKEN_MODELS = /^claude-(fable-5|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6|haiku-5)/

function contextWindowFor(model: string): number {
  return MILLION_TOKEN_MODELS.test(model) ? 1_000_000 : 200_000
}

// Folders the fleet never reads, from ~/.claude/fleet/config.json (the server writes it).
const DEFAULT_EXCLUDE_PATHS: string[] = []
let excludedRoots: string[] = []
let excludedRootsReadAt = 0

async function readExcludedRoots($: EngineInterface, home: string, now: number): Promise<string[]> {
  if (now - excludedRootsReadAt < 30000 && excludedRootsReadAt) return excludedRoots
  let paths = DEFAULT_EXCLUDE_PATHS
  try {
    const config = JSON.parse(await $.fs.read(`${home}/.claude/fleet/config.json`))
    if (Array.isArray(config.excludePaths)) paths = config.excludePaths.map(String)
  } catch {
    // No config yet: the default stands until the server writes one.
  }
  excludedRoots = paths.map(entry => entry.replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')).filter(Boolean)
  excludedRootsReadAt = now
  return excludedRoots
}

function isExcludedPath(roots: string[], cwd: string): boolean {
  return Boolean(cwd) && roots.some(root => cwd === root || cwd.startsWith(root + '/'))
}

function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function shortTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`
  return String(tokens)
}

function ago(now: number, then: number): string {
  if (!then) return ''
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

function fit(text: string, width: number): string {
  if (width <= 1) return ''
  return text.length <= width ? text : `${text.slice(0, width - 1)}…`
}

function meter(percent: number, cells: number): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)))
  return '█'.repeat(filled) + '░'.repeat(cells - filled)
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

const STATUS_RANK: Record<string, number> = { waiting: 0, busy: 1, shell: 2, idle: 3 }

function statusLook(session: FleetSession): { mark: string; label: string; color: string } {
  switch (session.status) {
    case 'waiting':
      return { mark: '◆', label: session.waitingFor || 'needs input', color: 'error' }
    case 'busy':
      return { mark: '●', label: 'working', color: 'warning' }
    case 'shell':
      return { mark: '$', label: 'shell', color: 'suggestion' }
    case 'idle':
      return { mark: '○', label: 'idle', color: 'success' }
    default:
      return { mark: '·', label: session.status || 'unknown', color: 'inactive' }
  }
}

async function readTranscript(
  $: EngineInterface,
  home: string,
  registration: Registration,
  now: number,
): Promise<TranscriptFacts | undefined> {
  const cached = transcriptCache.get(registration.sessionId)
  if (cached && now - cached.readAt < TRANSCRIPT_POLL_MS) return cached

  const path = `${home}/.claude/projects/${projectSlug(registration.cwd)}/${registration.sessionId}.jsonl`
  // $.fs.read refuses files over 4 MiB, and long sessions pass that: read the tail.
  const tail = await $.process.run(['tail', '-c', TRANSCRIPT_TAIL_BYTES, path])
  if (tail.exitCode !== 0) return cached

  const lines = tail.stdout.split('\n')
  let model = ''
  let contextTokens = -1
  let lastPrompt = ''
  for (let index = lines.length - 1; index >= 1; index--) {
    const line = lines[index]
    if (!line || line[0] !== '{') continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.isSidechain) continue
    const message = row.message
    if (contextTokens < 0 && row.type === 'assistant' && message?.usage && message.model !== '<synthetic>') {
      const usage = message.usage
      model = String(message.model ?? '')
      contextTokens =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
    }
    if (!lastPrompt && row.type === 'user' && !row.isMeta && typeof message?.content === 'string') {
      const text = oneLine(message.content)
      if (text && !text.startsWith('<')) lastPrompt = text
    }
    if (contextTokens >= 0 && lastPrompt) break
  }

  const facts: TranscriptFacts = {
    readAt: now,
    model: model || cached?.model || '',
    contextTokens: contextTokens >= 0 ? contextTokens : cached?.contextTokens ?? 0,
    lastPrompt: lastPrompt || cached?.lastPrompt || '',
  }
  transcriptCache.set(registration.sessionId, facts)
  return facts
}

async function readBranch($: EngineInterface, cwd: string, now: number): Promise<string> {
  const cached = branchCache.get(cwd)
  if (cached && now - cached.readAt < TRANSCRIPT_POLL_MS) return cached.branch
  let branch = ''
  try {
    const result = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeoutMs: 5000,
    })
    if (result.exitCode === 0) branch = result.stdout.trim()
  } catch {
    branch = ''
  }
  branchCache.set(cwd, { readAt: now, branch })
  return branch
}

async function scan($: EngineInterface): Promise<void> {
  if (isScanning) return
  isScanning = true
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    const now = await $.clock.now()
    const registryDir = `${home}/.claude/sessions`
    const entries = await $.fs.list(registryDir)

    const registrations: Registration[] = []
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(await $.fs.read(`${registryDir}/${entry.name}`))
        if (typeof parsed.pid === 'number' && typeof parsed.sessionId === 'string') {
          registrations.push(parsed)
        }
      } catch {
        // A file mid-write: the next tick reads it.
      }
    }

    // The folder keeps files of sessions that died; ps says which are alive and on which tty.
    const ttyByPid = new Map<number, string>()
    if (registrations.length > 0) {
      const listing = await $.process.run([
        'ps',
        '-o',
        'pid=,tty=',
        '-p',
        registrations.map(registration => registration.pid).join(','),
      ])
      for (const line of listing.stdout.split('\n')) {
        const [pidText, tty] = line.trim().split(/\s+/)
        if (pidText && tty) ttyByPid.set(Number(pidText), tty)
      }
    }

    const selfId = await $.session.id()
    const roots = await readExcludedRoots($, home, now)
    const live = registrations.filter(
      registration => ttyByPid.has(registration.pid) && !isExcludedPath(roots, registration.cwd),
    )
    const sessions: FleetSession[] = await Promise.all(
      live.map(async registration => {
        const isSelf = registration.sessionId === selfId
        const [facts, branch] = await Promise.all([
          readTranscript($, home, registration, now),
          readBranch($, registration.cwd, now),
        ])
        let model = facts?.model ?? ''
        let contextTokens = facts?.contextTokens ?? 0
        let contextWindow = Math.max(contextWindowFor(model), contextTokens > 200_000 ? 1_000_000 : 0)
        if (isSelf) {
          const usage = await $.session.usage()
          model = await $.session.model()
          contextTokens = usage.context.tokens ?? contextTokens
          contextWindow = usage.context.window || contextWindow
        }
        const tty = ttyByPid.get(registration.pid) ?? ''
        return {
          sessionId: registration.sessionId,
          pid: registration.pid,
          tty: tty === '??' ? '' : tty,
          name: registration.name || baseName(registration.cwd),
          cwd: registration.cwd,
          folder: baseName(registration.cwd),
          branch,
          status: registration.status ?? '',
          waitingFor: registration.waitingFor ?? '',
          model,
          contextTokens,
          contextWindow,
          lastPrompt: facts?.lastPrompt ?? '',
          updatedAt: registration.updatedAt ?? 0,
          startedAt: registration.startedAt ?? 0,
          version: registration.version ?? '',
          isSelf,
        }
      }),
    )

    sessions.sort(
      (left, right) =>
        (STATUS_RANK[left.status] ?? 9) - (STATUS_RANK[right.status] ?? 9) ||
        right.updatedAt - left.updatedAt,
    )

    for (const session of sessions) {
      const before = lastStatus.get(session.sessionId)
      if (before && before !== 'waiting' && session.status === 'waiting' && !session.isSelf) {
        $.ui.toast(`${session.name} needs input`)
      }
      lastStatus.set(session.sessionId, session.status)
    }

    await update($, sessionsAtom, () => sessions)
    await update($, scannedAtAtom, () => now)
  } finally {
    isScanning = false
  }
}

async function focusTab($: EngineInterface, session: FleetSession): Promise<void> {
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

// Through the dashboard server, as the page sends: each target takes its own
// message, so no reply comes back to this session.
async function sendTo($: EngineInterface, targets: FleetSession[], text: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  const now = await $.clock.now()
  const others = targets.filter(target => !target.isSelf)
  let queued = 0
  try {
    if (!isServerUp) await ensureServer($)
    const result = await callServer($, '/api/send', { sessionIds: others.map(target => target.sessionId), text: message })
    queued = Number(result?.queued ?? 0)
  } catch {
    queued = 0
  }
  const results: FleetSend[] = others.map(target => ({
    to: target.name,
    text: message,
    isDelivered: queued > 0,
    reason: queued > 0 ? '' : 'the dashboard server did not take it',
    at: now,
  }))
  await update($, lastSendAtom, () => results)
  $.ui.toast(queued ? `Queued for ${queued} of ${others.length}` : 'Not sent: the dashboard server is not answering')
}

async function openPane($: EngineInterface): Promise<void> {
  await update($, isOpenAtom, () => true)
  void scan($)
  await $.ui.open({ id: PANE, title: 'Fleet', focus: true, columns: 72 })
}

// ------------------------------------------------- the browser dashboard --
//
// server/fleet-server.mjs serves it on 127.0.0.1. Every session with this mod
// keeps it running, reports its own exact figures to it, and takes the
// messages the page sends it, as a prompt or a /model or /rename command.
// Sessions without the mod have theirs typed into their tab by the server.

const SERVER_URL = 'http://127.0.0.1:8770'
const HEARTBEAT_MS = 3000
const INBOX_POLL_MS = 2000
const SERVER_CHECK_MS = 30000

let serverToken = ''
let isServerUp = false
let isStartingServer = false

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

async function readServerToken($: EngineInterface): Promise<string> {
  const home = await $.env.get('HOME')
  try {
    serverToken = (await $.fs.read(`${home}/.claude/fleet/token`)).trim()
  } catch {
    serverToken = ''
  }
  return serverToken
}

type ServerHealth = { ok: boolean; version?: string }

async function serverHealth($: EngineInterface): Promise<ServerHealth | null> {
  try {
    const health = await $.http.fetch(`${SERVER_URL}/api/health`)
    return health.ok ? (JSON.parse(health.text) as ServerHealth) : null
  } catch {
    return null
  }
}

async function isServerHealthy($: EngineInterface): Promise<boolean> {
  return Boolean(await serverHealth($))
}

let ownVersion = ''
async function readOwnVersion($: EngineInterface): Promise<string> {
  if (ownVersion) return ownVersion
  try {
    ownVersion = String(JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version ?? '')
  } catch {
    ownVersion = ''
  }
  return ownVersion
}

// 1.10.0 is newer than 1.9.2: compared part by part as numbers.
function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (version: string) => version.split('.').map(part => Number.parseInt(part, 10) || 0)
  const [left, right] = [parse(candidate), parse(current)]
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0)
  }
  return false
}

// Node is found where people keep it, not only on the login shell's PATH:
// Homebrew, nvm, fnm, volta and asdf. Missing, it says so in the log and here.
let lastStartProblem = ''
const START_SERVER = String.raw`setopt nullglob 2>/dev/null
umask 077
mkdir -p "$HOME/.claude/fleet"
log="$HOME/.claude/fleet/server.log"
for candidate in "$(command -v node)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node" "$HOME/.local/share/fnm/aliases/default/bin/node" "$HOME/.asdf/shims/node" "$HOME"/.nvm/versions/node/*/bin/node; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    nohup "$candidate" "$1" >> "$log" 2>&1 < /dev/null &
    exit 0
  fi
done
echo "fleet: Node.js was not found; install Node 18 or newer" >> "$log"
exit 3`

async function ensureServer($: EngineInterface): Promise<boolean> {
  const health = await serverHealth($)
  const version = await readOwnVersion($)
  // A server from an older version of this plugin is retired, then started anew from here.
  const isStale = Boolean(health?.version && version && isNewerVersion(version, health.version))
  if (health && !isStale) {
    isServerUp = true
    return true
  }
  if (isStartingServer) return false
  isStartingServer = true
  try {
    if (isStale) {
      await callServer($, '/api/shutdown', { version }).catch(() => undefined)
      for (let attempt = 0; attempt < 10 && (await isServerHealthy($)); attempt++) await $.clock.sleep(300)
    }
    const script = `${$.plugin.root}/server/fleet-server.mjs`
    // Detached, its output in a file: it outlives this session, and no pipe holds the call.
    const started = await $.process.run(['/bin/zsh', '-lc', START_SERVER, 'fleet', script])
    lastStartProblem = started.exitCode === 3 ? 'Node.js 18 or newer was not found (Homebrew, nvm, fnm, volta or asdf).' : ''
    if (lastStartProblem) {
      isServerUp = false
      return false
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      await $.clock.sleep(300)
      if (await isServerHealthy($)) {
        isServerUp = true
        await readServerToken($)
        return true
      }
    }
    isServerUp = false
    return false
  } finally {
    isStartingServer = false
  }
}

async function callServer($: EngineInterface, route: string, body?: unknown): Promise<any> {
  if (!serverToken) await readServerToken($)
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await $.http.fetch(`${SERVER_URL}${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-fleet-token': serverToken, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    // A restarted server mints a new token: read it again once.
    if (response.status === 401 && attempt === 0) {
      await readServerToken($)
      continue
    }
    if (!response.ok) return undefined
    return response.text ? JSON.parse(response.text) : {}
  }
  return undefined
}

// A session in an excluded folder neither reports to the dashboard nor takes its messages.
async function isThisSessionExcluded($: EngineInterface): Promise<boolean> {
  const home = (await $.env.get('HOME')) ?? ''
  const roots = await readExcludedRoots($, home, await $.clock.now())
  return isExcludedPath(roots, await $.session.cwd())
}

async function heartbeat($: EngineInterface): Promise<void> {
  const [sessionId, model, usage, turns] = await Promise.all([
    $.session.id(),
    $.session.model(),
    $.session.usage(),
    $.session.turns(),
  ])
  await callServer($, '/api/heartbeat', {
    sessionId,
    cwd: await $.session.cwd(),
    model,
    context: usage.context,
    costUsd: usage.cost?.usd,
    turns,
    rateLimits: usage.rateLimits,
  })
}

type InboxMessage = {
  id: string
  sessionId: string
  text: string
  mode: 'prompt' | 'command'
  command?: string
  args?: string
}

// The only commands the dashboard may run here: the server checks them too.
const DASHBOARD_COMMANDS = new Set(['model', 'rename', 'compact'])

let isDeliveringInbox = false

async function deliverInbox($: EngineInterface): Promise<void> {
  // A poll that outlasts its period must not take the same messages twice.
  if (isDeliveringInbox) return
  isDeliveringInbox = true
  try {
    const sessionId = await $.session.id()
    const inbox = await callServer($, `/api/inbox?sessionId=${encodeURIComponent(sessionId)}`)
    for (const message of (inbox?.messages ?? []) as InboxMessage[]) {
      await deliverOne($, message)
    }
  } finally {
    isDeliveringInbox = false
  }
}

// A prompt or command queued here settles only once this session is idle and
// runs it, which can be minutes away: acknowledge on queueing, so the server
// never offers it again, and report a later refusal as a toast.
async function deliverOne($: EngineInterface, message: InboxMessage): Promise<void> {
  const acknowledge = (isDelivered: boolean, reason = '') =>
    callServer($, '/api/inbox/ack', { id: message.id, isDelivered, reason, mode: message.mode })
  if (message.mode === 'command') {
    if (!message.command || !DASHBOARD_COMMANDS.has(message.command)) {
      await acknowledge(false, 'not a dashboard command')
      return
    }
    await acknowledge(true)
    void $.command
      .run({ command: message.command, args: message.args ?? '' })
      .catch(error => $.ui.toast(`Fleet: /${message.command} did not run: ${error instanceof Error ? error.message : String(error)}`))
    return
  }
  if (message.mode === 'prompt') {
    await acknowledge(true)
    // Read as if typed here: a turn of its own once this session is idle.
    void $.prompt
      .submit({ text: message.text, asUser: true })
      .catch(error => $.ui.toast(`Fleet: a message was not submitted: ${error instanceof Error ? error.message : String(error)}`))
    return
  }
  // Only this session's own prompts and commands come here; nothing is relayed.
  await acknowledge(false, 'not a message for this session')
}

// The browser is signed in with a one-time code only a session can get: the
// dashboard holds no secret of its own, and opens for nobody else.
async function openBrowserDashboard($: EngineInterface): Promise<string> {
  if (!(await ensureServer($))) {
    return lastStartProblem
      ? `The dashboard server did not start: ${lastStartProblem}`
      : 'The dashboard server did not start: see ~/.claude/fleet/server.log.'
  }
  const login = await callServer($, '/api/login-code', {}).catch(() => undefined)
  const code = typeof login?.code === 'string' ? login.code : ''
  await $.process.run(['open', code ? `${SERVER_URL}/auth?code=${encodeURIComponent(code)}` : SERVER_URL])
  return `Fleet dashboard: ${SERVER_URL}`
}

// ------------------------------------------------------- hidden sessions --
// A hidden session (`claude --bg`) has no terminal to ask in: its permission
// prompts and questions go to the dashboard, which shows them in the session's
// chat with buttons, and the answer comes back here. A session in a terminal
// asks there as usual.
const allowedForSession = new Set<string>() // tools allowed for the rest of the session from the page
// Whether this session runs hidden, and the permission mode its last prompt was
// sent under (the server reads it from the transcript).
async function sessionMode($: EngineInterface): Promise<{ hidden: boolean; permissionMode: string }> {
  if (!isServerUp) return { hidden: false, permissionMode: '' }
  const answer = await callServer($, `/api/asks/mode?sessionId=${encodeURIComponent(await $.session.id())}`).catch(() => undefined)
  return { hidden: Boolean(answer?.hidden), permissionMode: String(answer?.permissionMode ?? '') }
}
async function isHiddenSession($: EngineInterface): Promise<boolean> {
  return (await sessionMode($)).hidden
}

// Puts one question on the page and waits for its answer, a long poll at a time.
// Undefined when the page cannot be reached or the call was abandoned.
async function askDashboard($: EngineInterface, ask: Record<string, unknown>, signal: AbortSignal): Promise<any> {
  const created = await callServer($, '/api/asks', { sessionId: await $.session.id(), ...ask }).catch(() => undefined)
  if (!created?.id) return undefined
  try {
    while (!signal.aborted) {
      const result = await callServer($, `/api/asks/wait?id=${encodeURIComponent(created.id)}`).catch(() => undefined)
      if (!result || result.status === 'gone') return undefined
      if (result.status === 'answered') return result.answer
    }
    return undefined
  } finally {
    if (signal.aborted) await callServer($, '/api/asks/cancel', { id: created.id }).catch(() => undefined)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'fleet',
      description: 'Toggle the dashboard pane of every Claude Code session on this machine; /fleet web opens it in the browser',
      argumentHint: '[web|close]',
    })
    $.clock.every(REGISTRY_POLL_MS, async () => {
      try {
        if (await read($, isOpenAtom)) await scan($)
      } catch {
        // One bad tick (a git or tail that timed out) must not end the refresh.
      }
    })
    void ensureServer($).catch(() => undefined)
    $.clock.every(SERVER_CHECK_MS, async () => {
      try {
        // A server that came back (restarted by another session) is up again here too.
        isServerUp = (await isServerHealthy($)) || (await ensureServer($))
      } catch {
        isServerUp = false
      }
    })
    $.clock.every(HEARTBEAT_MS, async () => {
      if (!isServerUp || (await isThisSessionExcluded($))) return
      try {
        await heartbeat($)
      } catch {
        isServerUp = false
      }
    })
    $.clock.every(INBOX_POLL_MS, async () => {
      if (!isServerUp || (await isThisSessionExcluded($))) return
      try {
        await deliverInbox($)
      } catch {
        // The next poll asks again; an unacknowledged message is offered again.
      }
    })
    return next(e)
  })

  // A tool that would ask for approval, in a hidden session: allowed or declined
  // from the page. Plugin PermissionRequest hooks are not run for these asks, so
  // the verdict is caught one step earlier, where the mode and rules settle it.
  // In auto mode the classifier settles asks itself, so those are left to it.
  on('tool.check', async ($, e, next) => {
    const verdict = await next(e)
    if (verdict.decision !== 'ask' || !e.tool_use_id || e.agentId) return verdict
    if (allowedForSession.has(e.tool)) return { ...verdict, decision: 'allow' as const }
    const mode = await sessionMode($)
    if (!mode.hidden || mode.permissionMode === 'auto') return verdict
    const answer = await askDashboard($, { kind: 'permission', toolName: e.tool, toolInput: e.input, reason: verdict.reason ?? '' }, next.signal)
    if (!answer) return verdict
    if (answer.allow && answer.remember) allowedForSession.add(e.tool)
    return answer.allow
      ? { ...verdict, decision: 'allow' as const, reason: 'Allowed from the Fleet dashboard' }
      : { ...verdict, decision: 'deny' as const, reason: answer.message || 'Declined from the Fleet dashboard.' }
  })

  // A question Claude puts to you, in a hidden session: answered on the page.
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    if (!(await isHiddenSession($))) return next(e)
    const answer = await askDashboard($, { kind: 'question', toolName: 'AskUserQuestion', questions: e.questions }, next.signal)
    if (!answer) return next(e)
    return { result: { questions: e.questions, answers: answer.answers ?? {}, ...(answer.response ? { response: answer.response } : {}) } }
  })

  // /fleet toggles the pane; /fleet close only closes it; /fleet web opens the browser.
  on('command.run', { command: 'fleet' }, async ($, e) => {
    const args = String(e.args ?? '').trim()
    if (args === 'web') return { text: await openBrowserDashboard($) }
    if (args === 'close' || (args === '' && (await read($, isOpenAtom)))) {
      await $.ui.close({ id: PANE })
      await update($, isOpenAtom, () => false)
      return { text: 'Fleet pane closed.' }
    }
    await openPane($)
    return { text: 'Fleet pane opened. Run /fleet again to close it.' }
  })

  on('ui.close', { id: PANE }, async ($, e, next) => {
    await update($, isOpenAtom, () => false)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    // The mobile surface draws no text field: it reads and focuses only.
    const Input = 'Input' in table ? table.Input : undefined
    const sessions = await read($, sessionsAtom)
    const selected = await read($, selectedAtom)
    const sends = await read($, lastSendAtom)
    const scannedAt = await read($, scannedAtAtom)
    const now = await $.clock.now()
    const width = Math.max(24, e.props.bodyColumns)

    const counts = { waiting: 0, busy: 0, idle: 0 }
    for (const session of sessions) {
      if (session.status === 'waiting') counts.waiting++
      else if (session.status === 'busy') counts.busy++
      else counts.idle++
    }
    const failures = sends.filter(send => !send.isDelivered)

    return (
      <Box flexDirection="column">
        <Text>
          <Text weight="bold">{sessions.length} sessions</Text>
          <Text dimColor> · </Text>
          <Text color="error">{counts.waiting} waiting</Text>
          <Text dimColor> · </Text>
          <Text color="warning">{counts.busy} working</Text>
          <Text dimColor> · </Text>
          <Text color="success">{counts.idle} idle</Text>
          <Text dimColor>{scannedAt ? `  ${ago(now, scannedAt)} ago` : '  scanning…'}</Text>
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button
            key="open-web"
            label="Open browser dashboard"
            hotkey="o"
            onPress={async () => $.ui.toast(await openBrowserDashboard($))}
          />
        </Box>
        <Text> </Text>
        {sessions.map(session => {
          const look = statusLook(session)
          const isSelected = session.sessionId === selected
          const percent = session.contextWindow
            ? Math.round((session.contextTokens / session.contextWindow) * 100)
            : 0
          const contextColor = percent >= 80 ? 'error' : percent >= 60 ? 'warning' : 'inactive'
          const meta = [
            session.folder,
            session.branch && `⎇ ${session.branch}`,
            session.model.replace(/^claude-/, ''),
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <Box flexDirection="column" marginBottom={isSelected ? 1 : 0}>
              <Button
                key={`row-${session.sessionId}`}
                plain
                onPress={async () => {
                  await update($, selectedAtom, current =>
                    current === session.sessionId ? '' : session.sessionId,
                  )
                  if (!session.isSelf) {
                    // Best effort: the box is drawn by the redraw this write starts.
                    void $.ui
                      .focus({ requestId: PANE, key: `msg-${session.sessionId}` })
                      .catch(() => undefined)
                  }
                }}
              >
                <Text color={look.color}>{look.mark}</Text>{' '}
                <Text weight={isSelected ? 'bold' : 'regular'}>
                  {fit(session.name, Math.max(8, width - 26))}
                </Text>
                {session.isSelf ? <Text dimColor> (this)</Text> : ''}
                <Text color={look.color}> {look.label}</Text>
                <Text dimColor> {ago(now, session.updatedAt)}</Text>
              </Button>
              <Text dimColor wrap="truncate-end">
                {'  '}
                {fit(meta, Math.max(8, width - 18))}
                {'  '}
                <Text color={contextColor}>
                  ctx {meter(percent, 8)} {percent}% {shortTokens(session.contextTokens)}
                </Text>
              </Text>
              {isSelected && (
                <Box flexDirection="column" paddingLeft={2} marginTop={1}>
                  <Text dimColor wrap="truncate-end">
                    {session.cwd}
                  </Text>
                  <Text dimColor>
                    pid {session.pid} · {session.tty || 'no tty'} · v{session.version} · up{' '}
                    {ago(now, session.startedAt)}
                  </Text>
                  {session.lastPrompt && (
                    <Text wrap="truncate-end">
                      <Text dimColor>last: </Text>
                      {fit(session.lastPrompt, width * 2)}
                    </Text>
                  )}
                  <Box flexDirection="row" gap={1} marginTop={1}>
                    <Button
                      key={`focus-${session.sessionId}`}
                      label="Go to tab"
                      hotkey="g"
                      variant="primary"
                      onPress={() => focusTab($, session)}
                    />
                    <Button
                      key={`close-${session.sessionId}`}
                      label="Close"
                      hotkey="x"
                      onPress={() => update($, selectedAtom, () => '')}
                    />
                  </Box>
                  {session.isSelf ? (
                    <Text dimColor>This is the dashboard's own session.</Text>
                  ) : (
                    Input && (
                    <Input
                      key={`msg-${session.sessionId}`}
                      label="› "
                      placeholder={`Message ${session.name}…`}
                      submitLabel="send"
                      autoFocus
                      onSubmit={(text: string) => sendTo($, [session], text)}
                    />
                    )
                  )}
                </Box>
              )}
            </Box>
          )
        })}
        {sessions.length === 0 && <Text dimColor>No running sessions found.</Text>}
        {failures.map(failure => (
          <Text color="error" wrap="truncate-end">
            {failure.to}: {failure.reason}
          </Text>
        ))}
      </Box>
    )
  })
}
