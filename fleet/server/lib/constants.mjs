// Fixed values: the port, where Claude Code keeps its sessions and transcripts,
// this server's data folder and files, scan timings, the plugin version, and the
// pricing.json and config.json written when a file is missing.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PORT = Number(process.env.FLEET_PORT || 8770)
export const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude')
export const REGISTRY_DIR = path.join(CLAUDE_DIR, 'sessions')
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')
// FLEET_DATA_DIR runs a second dashboard (another port) without sharing the first one's token.
export const DATA_DIR = process.env.FLEET_DATA_DIR || path.join(CLAUDE_DIR, 'fleet')
export const TOKEN_FILE = path.join(DATA_DIR, 'token')
export const PRICING_FILE = path.join(DATA_DIR, 'pricing.json')
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
export const STATUS_LOG_FILE = path.join(DATA_DIR, 'status-log.jsonl')
export const RECENTLY_CLOSED_FILE = path.join(DATA_DIR, 'recently-closed.json')

// lib/ sits inside server/: the page, the plugin manifest and the entry script are found from there.
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY_SCRIPT = path.join(SERVER_DIR, 'fleet-server.mjs')
export const WEB_DIR = path.join(SERVER_DIR, 'web')

export const REGISTRY_POLL_MS = 2000
export const TRANSCRIPT_POLL_MS = 15000
// The status log feeds the 24-hour timeline; transcripts feed the reports, whose
// longest range is the last 30 days.
export const HISTORY_DAYS = 8
export const TRANSCRIPT_DAYS = 31
export const REPORT_RANGES = { today: 1, '7d': 7, '30d': 30 }
export const HEARTBEAT_FRESH_MS = 15000
export const IDLE_EXIT_MS = 60 * 60 * 1000
export const ACTIVITY_GAP_MIN = 2
export const DAY_MS = 24 * 60 * 60 * 1000

export const BROWSER_SECRET_FILE = path.join(DATA_DIR, 'browser-secret')
const PLUGIN_MANIFEST = path.join(SERVER_DIR, '..', '.claude-plugin', 'plugin.json')

// The plugin version this server came from: a session on a newer one retires it.
function readPluginVersion() {
  try {
    return String(JSON.parse(fs.readFileSync(PLUGIN_MANIFEST, 'utf8')).version || '')
  } catch {
    return ''
  }
}
export const VERSION = readPluginVersion()

// API-equivalent list prices, USD per million tokens. On a subscription this
// is not a bill; it says what the same traffic would cost on the API.
// Edit ~/.claude/fleet/pricing.json to change any figure.
export const DEFAULT_PRICING = {
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

// Folders the fleet never reads: no session, transcript or figure from under them.
export const DEFAULT_CONFIG = {
  note: 'excludePaths: folders (and everything under them) the dashboard ignores. newSessionRoot: the folder whose subfolders New session and Resume session offer. ~ is your home folder.',
  excludePaths: [],
  newSessionRoot: '~',
}

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
