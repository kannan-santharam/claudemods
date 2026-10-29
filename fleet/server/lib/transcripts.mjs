import fsp from 'node:fs/promises'
import path from 'node:path'
import { DAY_MS, HISTORY_DAYS, PROJECTS_DIR } from './constants.mjs'
import { isExcludedProjectDir } from './config.mjs'
import { baseModel, emptyTokens } from './pricing.mjs'
import { files, transcriptScan } from './state.mjs'
import { baseName, dayKey, log } from './utils.mjs'

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

export async function scanTranscripts() {
  if (transcriptScan.isScanning) return
  transcriptScan.isScanning = true
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
    transcriptScan.filesVersion++
    transcriptScan.readyAt = Date.now()
  } finally {
    transcriptScan.isScanning = false
  }
}
