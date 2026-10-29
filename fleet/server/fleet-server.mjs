// Fleet: a local dashboard of every Claude Code session on this machine.
//
// One process per machine, bound to 127.0.0.1; the port is the lock, so a
// second start exits. The fleet mod starts it from any session that finds it
// down, heartbeats its own session into it, and delivers what the page sends.
//
// Reads: ~/.claude/sessions/*.json (who is running), `ps` (alive, which tty),
// git (branch), ~/.claude/projects/**/*.jsonl (tokens, tools, activity).
// Writes: ~/.claude/fleet/ (token, pricing, status log, server log).

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { loadConfig } from './lib/config.mjs'
import {
  BROWSER_SECRET_FILE,
  CONFIG_FILE,
  DATA_DIR,
  IDLE_EXIT_MS,
  PORT,
  PRICING_FILE,
  REGISTRY_POLL_MS,
  TOKEN_FILE,
  TRANSCRIPT_POLL_MS,
} from './lib/constants.mjs'
import { loadPricing } from './lib/pricing.mjs'
import { loadRecentlyClosed } from './lib/recently-closed.mjs'
import { loadStatusLog, pruneMemory, scanRegistry } from './lib/registry.mjs'
import { loadSecret } from './lib/security.mjs'
import { handleRequest } from './lib/server.mjs'
import { live, registryState, secrets } from './lib/state.mjs'
import { scanTranscripts } from './lib/transcripts.mjs'
import { deliverTyped } from './lib/typing.mjs'
import { log } from './lib/utils.mjs'
import { scanWebFiles } from './lib/web-files.mjs'

scanWebFiles()

const server = http.createServer(handleRequest)

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
secrets.token = loadSecret(TOKEN_FILE)
secrets.browserSecret = loadSecret(BROWSER_SECRET_FILE)
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
    if (!live.size && Date.now() - registryState.lastSeenLiveAt > IDLE_EXIT_MS) {
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
