import type { EngineInterface } from 'claude-code'

// ------------------------------------------------- the browser dashboard --
//
// server/fleet-server.mjs serves it on 127.0.0.1. Every session with this mod
// keeps it running, reports its own exact figures to it, and takes the
// messages the page sends it, as a prompt or a /model or /rename command.
// Sessions without the mod have theirs typed into their tab by the server.

export const SERVER_URL = 'http://127.0.0.1:8770'
export const SERVER_CHECK_MS = 30000

let serverToken = ''
// Written here and by the session.start timers, read by sendTo and the timers:
// an object, so every file sees the one value.
export const serverState = { isUp: false }
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

export async function isServerHealthy($: EngineInterface): Promise<boolean> {
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

export async function ensureServer($: EngineInterface): Promise<boolean> {
  const health = await serverHealth($)
  const version = await readOwnVersion($)
  // A server from an older version of this plugin is retired, then started anew from here.
  const isStale = Boolean(health?.version && version && isNewerVersion(version, health.version))
  if (health && !isStale) {
    serverState.isUp = true
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
      serverState.isUp = false
      return false
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      await $.clock.sleep(300)
      if (await isServerHealthy($)) {
        serverState.isUp = true
        await readServerToken($)
        return true
      }
    }
    serverState.isUp = false
    return false
  } finally {
    isStartingServer = false
  }
}

export async function callServer($: EngineInterface, route: string, body?: unknown): Promise<any> {
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

// The browser is signed in with a one-time code only a session can get: the
// dashboard holds no secret of its own, and opens for nobody else.
export async function openBrowserDashboard($: EngineInterface): Promise<string> {
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
