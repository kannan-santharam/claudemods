// Per-session summaries built from the transcript tallies, and the Reports tab:
// usage by day and model, projects, tools and the activity timeline.

import { ACTIVITY_GAP_MIN, DAY_MS } from './constants.mjs'
import { includedTranscripts } from './config.mjs'
import { addTokens, costOf, emptyTokens } from './pricing.mjs'
import { live, registryState, settings, transcriptScan } from './state.mjs'
import { baseName, dayKey } from './utils.mjs'

export function sessionSummaries(sinceDay) {
  const sessions = new Map()
  for (const transcript of includedTranscripts()) {
    let summary = sessions.get(transcript.sessionId)
    if (!summary) {
      summary = {
        sessionId: transcript.sessionId,
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
      sessions.set(transcript.sessionId, summary)
    }
    if (transcript.isSubagent) summary.subagents++
    else {
      summary.cwd = transcript.cwd || summary.cwd
      summary.branch = transcript.branch || summary.branch
      summary.model = transcript.model || summary.model
      summary.title = transcript.title || summary.title
      summary.agentName = transcript.agentName || summary.agentName
      summary.firstPrompt = summary.firstPrompt || transcript.firstPrompt
      if (transcript.lastPromptAt >= summary.lastPromptAt && transcript.lastPrompt) {
        summary.lastPrompt = transcript.lastPrompt
        summary.lastPromptAt = transcript.lastPromptAt
      }
      if (transcript.lastReplyAt >= summary.lastReplyAt && transcript.lastReply) {
        summary.lastReply = transcript.lastReply
        summary.lastReplyAt = transcript.lastReplyAt
      }
      if (transcript.lastToolAt >= summary.lastToolAt && transcript.lastTool) {
        summary.lastTool = transcript.lastTool
        summary.lastToolAt = transcript.lastToolAt
      }
      summary.contextTokens = transcript.contextTokens
      summary.prompts += transcript.prompts
    }
    summary.firstAt = summary.firstAt ? Math.min(summary.firstAt, transcript.firstAt || summary.firstAt) : transcript.firstAt
    summary.lastAt = Math.max(summary.lastAt, transcript.lastAt)
    summary.commits += transcript.commits
    summary.pushes += transcript.pushes
    for (const [day, byModel] of Object.entries(transcript.usage)) {
      if (day < sinceDay) continue
      for (const [model, tokens] of Object.entries(byModel)) {
        addTokens(summary.tokens, tokens)
        const modelTokens = (summary.byModel[model] ||= emptyTokens())
        addTokens(modelTokens, tokens)
        summary.cost += costOf(model, tokens)
      }
    }
    for (const [tool, count] of Object.entries(transcript.tools)) summary.tools[tool] = (summary.tools[tool] || 0) + count
    for (const [file, count] of Object.entries(transcript.filesTouched))
      summary.filesTouched[file] = (summary.filesTouched[file] || 0) + count
  }
  // A session known only from its subagents' files takes their cwd: one pass, not one per session.
  const cwdBySession = new Map()
  for (const transcript of includedTranscripts()) if (transcript.cwd && !cwdBySession.has(transcript.sessionId)) cwdBySession.set(transcript.sessionId, transcript.cwd)
  for (const summary of sessions.values()) {
    if (!summary.cwd) summary.cwd = cwdBySession.get(summary.sessionId) || ''
    summary.project = baseName(summary.cwd || 'unknown')
  }
  return sessions
}

function activitySegments(sessionId, since) {
  const minutes = []
  for (const transcript of includedTranscripts()) {
    if (transcript.sessionId !== sessionId) continue
    for (const minute of transcript.activeMinutes) if (minute * 60000 >= since) minutes.push(minute)
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
  const entries = registryState.statusLog.filter(entry => entry.sessionId === sessionId)
  const segments = []
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]
    const end = entries[index + 1]?.t ?? (live.has(sessionId) ? now : entry.t)
    if (end < since || entry.status === 'ended') continue
    segments.push({ status: entry.status, start: Math.max(entry.t, since), end })
  }
  return segments
}

export function buildReport(range) {
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
  for (const transcript of includedTranscripts()) {
    for (const [day, byModel] of Object.entries(transcript.usage)) {
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
    transcriptsReadyAt: transcriptScan.readyAt,
    statusLogSince: registryState.statusLog[0]?.t || now,
    totals,
    days: dayList.map(day => ({ day, byModel: perDay[day] })),
    models: [...models].sort(),
    pricingModels: Object.keys(settings.pricing.models || {}),
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

// A name Claude Code derived from the folder (my-app-9b) says nothing:
// the session's own agent name, then its title, then its first prompt say more.
export function displayName(session, summary) {
  if (session.nameSource !== 'derived') return session.name
  const fromPrompt = summary?.firstPrompt
    ? summary.firstPrompt.split(/\s+/).slice(0, 8).join(' ').slice(0, 56) + (summary.firstPrompt.length > 56 ? '…' : '')
    : ''
  return summary?.agentName || summary?.title || fromPrompt || session.name
}
