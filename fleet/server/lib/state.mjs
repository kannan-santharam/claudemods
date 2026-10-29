// Every piece of state the server keeps between requests lives here, so every
// module sees the same copy. ES module bindings cannot be reassigned by the
// modules that import them, so each export is a container that is changed in
// place: a Map, a Set or an array, or a plain object whose fields are set.
// Nothing here is ever reassigned.

import { DEFAULT_PRICING } from './constants.mjs'

// Two secrets, each kept 0600 in the data folder so a restart keeps them:
// the token for the sessions' mods (they read the file), the browser secret for
// the dashboard's cookie. Neither is ever written into a page.
export const secrets = { token: '', browserSecret: '' }

// What pricing.json and config.json say, reloaded when either file changes.
export const settings = { pricing: DEFAULT_PRICING, excludedRoots: [], newSessionRoot: '' }

export const live = new Map() // sessionId -> session row
export const heartbeats = new Map() // sessionId -> heartbeat
export const branchCache = new Map() // cwd -> { at, branch }
export const lastStatus = new Map() // sessionId -> status
export const registryState = {
  statusLog: [], // { t, sessionId, name, status }
  lastSeenLiveAt: Date.now(),
  lastStatusTrim: Date.now(),
  recentlyClosed: [],
}

// One entry per transcript file: what has been read and what it added up to.
export const transcripts = new Map()
export const excludedDirCache = new Map() // dir -> { roots, isExcluded }
export const transcriptScan = { isScanning: false, version: 0, readyAt: 0 } // version counts finished scans

export const metaCache = new Map() // path -> { mtimeMs, meta }
// Subagent files and main transcripts by session, rebuilt after each transcript scan.
export const transcriptIndexes = {
  subagentIndex: { version: -1, bySession: new Map() },
  mainFileIndex: { version: -1, bySession: new Map() },
}
export const liveCache = { at: 0, view: null }

export const asks = new Map() // id -> { id, sessionId, kind, toolName, toolInput, suggestions, questions, createdAt, answer }
export const askWaiters = new Map() // id -> Set of resolve(answer)

export const messaging = {
  inbox: [], // { id, sessionId, text, createdAt, claimedAt, claimedBy }
  isTyping: false,
}
export const deliveries = [] // { id, sessionId, name, text, at, isDelivered, reason, via }
// AppleScript calls against Terminal, chained so they run one at a time.
export const terminal = { queue: Promise.resolve() }
// Sessions whose /model switch is being watched for its "Switch model?" question.
export const watchedModelSwitches = new Set()

export const loginCodes = new Map() // code -> expiry
// The page's files that may be served (URL path -> file), a listing in progress
// and when the last one finished.
export const webState = { files: new Map(), scan: null, scannedAt: 0 }
