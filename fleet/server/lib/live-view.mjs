// The live view the page polls every two seconds: each running session with its
// summary, heartbeat figures, running subagents, background shells and open questions.

import fs from 'node:fs'
import { DAY_MS, HEARTBEAT_FRESH_MS } from './constants.mjs'
import { pendingAsks } from './asks.mjs'
import { activityOf, subagentActivity } from './conversation.mjs'
import { baseModel } from './pricing.mjs'
import { displayName, sessionSummaries } from './reports.mjs'
import { deliveries, heartbeats, live, liveCache, metaCache, transcriptIndexes, transcripts, transcriptScan } from './state.mjs'
import { stuckOf } from './stuck.mjs'
import { mainTranscriptOf } from './transcripts.mjs'
import { baseName, dayKey, stripAnsi } from './utils.mjs'
import { workPlaceOf } from './work-place.mjs'

// Without the session's own report, the window is the model's: these run with 1M tokens.
const MILLION_TOKEN_MODELS = /^claude-(fable-5|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6|haiku-5)/

function contextWindowFor(model) {
  return MILLION_TOKEN_MODELS.test(baseModel(model)) ? 1_000_000 : 200_000
}

// Subagents a session spawned: each writes <session>/subagents/agent-<id>.jsonl
// beside a .meta.json naming its type and description and, once done, finished.

const SUBAGENT_STALE_MS = 15 * 60 * 1000

// Subagent files by session, from the index rebuilt after each transcript scan.
function subagentTranscriptsOf(sessionId) {
  if (transcriptIndexes.subagentIndex.version !== transcriptScan.version) {
    const bySession = new Map()
    for (const transcript of transcripts.values()) {
      if (!transcript.isSubagent) continue
      if (!bySession.has(transcript.sessionId)) bySession.set(transcript.sessionId, [])
      bySession.get(transcript.sessionId).push(transcript)
    }
    transcriptIndexes.subagentIndex = { version: transcriptScan.version, bySession }
  }
  return transcriptIndexes.subagentIndex.bySession.get(sessionId) || []
}

// The background shells a session still has running, with the end of their output.
const SHELL_OUTPUT = /^\/(private\/)?tmp\/claude-[^/]+\/.+\/tasks\/[\w-]+\.output$/

export function shellsOf(session, now) {
  const transcript = mainTranscriptOf(session.sessionId)
  if (!transcript?.shells?.size) return []
  // A shell from before this process started (the session was resumed) died with the old one.
  const since = (session.startedAt || 0) - 10_000
  const found = []
  for (const shell of transcript.shells.values()) {
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
    const lines = stripAnsi(buffer.toString('utf8')).split(/\r?\n|\r/).map(line => line.trim()).filter(Boolean)
    return { lastOutput: (lines[lines.length - 1] || '').slice(0, 240), outputAt: stat.mtimeMs }
  } catch {
    return { lastOutput: '', outputAt: 0 }
  }
}

// Running subagents for the live view; with `withFinished`, the finished ones
// too, for the session's Subagents tab.
function subagentsOf(sessionId, now, withFinished = false) {
  const found = []
  const since = (live.get(sessionId)?.startedAt || 0) - 10_000
  for (const transcript of subagentTranscriptsOf(sessionId)) {
    let stat
    try {
      stat = fs.statSync(transcript.filePath)
    } catch {
      continue
    }
    const metaPath = transcript.filePath.replace(/\.jsonl$/, '.meta.json')
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
    // A background subagent that ended its turn with shells of its own still
    // running is not done: it is woken when they finish. One that has handed
    // its report back is done whatever it left running. Shells from before
    // this process started died with the old one, as a session's do.
    let waitingShells = 0
    if (meta.finished === true && transcript.lastTool !== 'SubagentHandback') for (const shell of transcript.shells?.values() || []) if (!shell.endedAt && shell.startedAt >= since && now - shell.startedAt < DAY_MS) waitingShells++
    const isRunning = waitingShells > 0 || (meta.finished !== true && now - stat.mtimeMs < SUBAGENT_STALE_MS)
    // A subagent leaves the live view as soon as it finishes.
    if (!isRunning && !withFinished) continue
    found.push({
      agentId: baseName(transcript.filePath).replace(/^agent-|\.jsonl$/g, ''),
      description: String(meta.description || transcript.firstPrompt || 'subagent').slice(0, 120),
      agentType: String(meta.agentType || ''),
      model: String(meta.model || transcript.model || ''),
      isBackground: meta.requestShape === 'background',
      isRunning,
      waitingShells,
      startedAt: transcript.firstAt,
      lastAt: stat.mtimeMs,
      ...(withFinished ? { transcript } : {}),
    })
  }
  return found.sort((left, right) => Number(right.isRunning) - Number(left.isRunning) || right.lastAt - left.lastAt)
}

// Every subagent a session started (in the transcripts read, the last 31
// days), running ones first, each running one with what it is doing.
const SUBAGENTS_SHOWN = 100
export async function listSubagents(sessionId) {
  const found = subagentsOf(sessionId, Date.now(), true).slice(0, SUBAGENTS_SHOWN)
  for (const agent of found) {
    if (agent.isRunning && !agent.waitingShells) agent.activity = await subagentActivity(agent.transcript)
    delete agent.transcript
  }
  return found
}

// Each open dashboard asks every 2 seconds: one answer serves them all for a second.

export function liveView() {
  if (liveCache.view && Date.now() - liveCache.at < 1000) return liveCache.view
  Object.assign(liveCache, { at: Date.now(), view: buildLiveView() })
  return liveCache.view
}

function buildLiveView() {
  const now = Date.now()
  const today = dayKey(now)
  const summaries = sessionSummaries(today)
  const rateLimits = new Map()
  const sessions = [...live.values()].map(session => {
    const heartbeat = heartbeats.get(session.sessionId)
    const hasMod = Boolean(heartbeat && now - heartbeat.at < HEARTBEAT_FRESH_MS)
    const summary = summaries.get(session.sessionId)
    let contextTokens = summary?.contextTokens || 0
    let contextWindow = Math.max(contextWindowFor(summary?.model), contextTokens > 200_000 ? 1_000_000 : 0)
    let model = summary?.model || ''
    if (hasMod) {
      model = baseModel(heartbeat.model) || model
      // Straight after a compaction the session still reports its last response's size.
      if (heartbeat.context?.tokens != null && !summary?.isContextFromCompaction) contextTokens = heartbeat.context.tokens
      if (heartbeat.context?.window) contextWindow = heartbeat.context.window
      for (const limit of heartbeat.rateLimits || []) {
        const known = rateLimits.get(limit.kind)
        if (!known || (heartbeat.at > known.at)) rateLimits.set(limit.kind, { ...limit, at: heartbeat.at })
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
      sessionCostUsd: hasMod ? heartbeat.costUsd ?? null : null,
      turns: hasMod ? heartbeat.turns ?? null : null,
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
      // Set when its work is in another repository than the folder it was started in.
      work: workPlaceOf(session.cwd, summary?.workPlaces),
      lastActivityAt: Math.max(summary?.lastAt || 0, session.updatedAt || 0),
      subagents: subagentsOf(session.sessionId, now),
      shells: shellsOf(session, now),
      asks: pendingAsks(session.sessionId),
      // What it is doing, in a sentence, while it works.
      activity: session.status === 'busy' ? activityOf(session.sessionId) : null,
      // While it works, whether it may be going round in circles.
      stuck: session.status === 'busy' ? stuckOf(session.sessionId) : null,
      subagentCount: summary?.subagents || 0,
    }
  })
  // A question waiting on the page is the session waiting for you, whatever its registry says.
  for (const session of sessions) {
    // Auto mode's ask shows once its dialog is open: the session waits, or its tab shows it.
    session.asks = session.asks.filter(ask => !ask.whenWaiting || ask.wasSeen || session.status === 'waiting')
    if (!session.asks.length) continue
    session.status = 'waiting'
    session.stuck = null
    session.waitingFor = session.asks[0].kind === 'question' ? 'a question for you' : `permission for ${session.asks[0].toolName}`
  }
  const statusOrder = { waiting: 0, busy: 1, shell: 2, idle: 3 }
  sessions.sort(
    (left, right) => (statusOrder[left.status] ?? 9) - (statusOrder[right.status] ?? 9) || right.lastActivityAt - left.lastActivityAt,
  )
  return {
    generatedAt: now,
    sessions,
    rateLimits: [...rateLimits.values()],
    deliveries: deliveries.slice(-20),
  }
}
