// Fixed values: the port, where Claude Code keeps its sessions and transcripts,
// this server's data folder and files, scan timings, the plugin version, the
// bundled price table and the config.json written when that file is missing.

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
export const PRICING_OVERRIDES_FILE = path.join(DATA_DIR, 'pricing-overrides.json')
export const LIVE_PRICING_FILE = path.join(DATA_DIR, 'pricing-live.json')
export const PRICING_PAGE_URL = 'https://platform.claude.com/docs/en/about-claude/pricing.md'
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json')
export const STATUS_LOG_FILE = path.join(DATA_DIR, 'status-log.jsonl')
export const RECENTLY_CLOSED_FILE = path.join(DATA_DIR, 'recently-closed.json')

// lib/ sits inside server/: the page, the plugin manifest and the entry script are found from there.
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const ENTRY_SCRIPT = path.join(SERVER_DIR, 'fleet-server.mjs')
export const WEB_DIR = path.join(SERVER_DIR, 'web')

export const REGISTRY_POLL_MS = 2000
export const TRANSCRIPT_POLL_MS = 15000
export const PRICING_CHECK_MS = 60 * 60 * 1000
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

// API-equivalent list prices, USD per million tokens, as Anthropic's pricing
// page gave them on 30 Oct 2026. The page is read again once a day
// (live-pricing.mjs), and what it says replaces this table; this one stands
// until the first read, or when reading is turned off (livePricing: false in
// config.json). On a subscription none of it is a bill: it says what the same
// traffic would cost on the API. pricing-overrides.json, if you write one, has
// the last word for any model and figure it names.
export const DEFAULT_PRICING = {
  source: 'bundled',
  fetchedAt: 0,
  models: {
    'claude-fable-5-1': { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
    'claude-mythos-5-1': { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 0.25, output: 50 },
    'claude-fable-5': { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
    'claude-mythos-5': { input: 10, cacheWrite5m: 12.5, cacheWrite1h: 20, cacheRead: 1, output: 50 },
    'claude-opus-5-5': { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20, fast: { input: 8, output: 40 } },
    'claude-opus-5': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, fast: { input: 10, output: 50 } },
    'claude-opus-4-8': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25, fast: { input: 10, output: 50 } },
    'claude-opus-4-7': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
    'claude-opus-4-6': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
    'claude-opus-4-5': { input: 5, cacheWrite5m: 6.25, cacheWrite1h: 10, cacheRead: 0.5, output: 25 },
    'claude-opus-4-1': { input: 15, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5, output: 75 },
    'claude-opus-4': { input: 15, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5, output: 75 },
    'claude-sonnet-5-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
    'claude-sonnet-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2, output: 10 },
    'claude-sonnet-4-6': { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
    'claude-sonnet-4-5': { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
    'claude-sonnet-4': { input: 3, cacheWrite5m: 3.75, cacheWrite1h: 6, cacheRead: 0.3, output: 15 },
    'claude-haiku-5-5': { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5, long: { overTokens: 100000, input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 } },
    'claude-haiku-4-5': { input: 1, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1, output: 5 },
    'claude-haiku-3-5': { input: 0.8, cacheWrite5m: 1, cacheWrite1h: 1.6, cacheRead: 0.08, output: 4 },
  },
  residency: { multiplier: 1.1, fromVersion: [4, 6] },
  webSearchPerThousand: 10,
}

// Folders the fleet never reads: no session, transcript or figure from under them.
export const DEFAULT_CONFIG = {
  note: 'excludePaths: folders (and everything under them) the dashboard ignores. newSessionRoot: the folder whose subfolders New session and Resume session offer. ~ is your home folder.',
  excludePaths: [],
  newSessionRoot: '~',
}

export const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
