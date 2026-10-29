import fs from 'node:fs'
import path from 'node:path'
import { HOME } from './constants.mjs'
import { scanRegistry } from './registry.mjs'
import { live } from './state.mjs'
import { focusTab, openInTerminal } from './terminal.mjs'
import { run, shellQuote, stripAnsi } from './utils.mjs'

// A hidden session runs in Claude Code's own background service (`claude --bg`):
// no terminal window opens, and the dashboard is how it is reached. `claude
// attach <id>` opens it in a terminal at any time; `claude stop <id>` ends it.
export function claudeBinary() {
  for (const candidate of [path.join(HOME, '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (fs.existsSync(candidate)) return candidate
  }
  return 'claude'
}

export async function startHidden(cwd, args) {
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
export async function attachHidden(sessionId) {
  const session = live.get(sessionId)
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  if (!session.hidden) return focusTab(sessionId)
  return openInTerminal(`${shellQuote(claudeBinary())} attach ${shellQuote(session.jobId)}`)
}
