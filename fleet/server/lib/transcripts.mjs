// Transcripts (~/.claude/projects/**/*.jsonl), read incrementally every fifteen
// seconds: each file's new lines are folded into a running tally of tokens,
// tools, prompts, replies, background shells and active minutes.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { DAY_MS, HISTORY_DAYS, PROJECTS_DIR } from './constants.mjs'
import { isExcludedProjectDir } from './config.mjs'
import { baseModel, emptyTokens } from './pricing.mjs'
import { transcripts, transcriptScan } from './state.mjs'
import { baseName, dayKey, log } from './utils.mjs'

// What the person typed in a user row: a string, or the text blocks of one sent
// with images. Tool results, meta rows, compaction summaries and the tagged rows
// Claude Code adds itself (notifications, slash command echoes) are not prompts.
export function typedPromptOf(row) {
  const content = row.message?.content
  if (row.isMeta || row.isCompactSummary) return ''
  const typed = typeof content === 'string'
    ? content
    : Array.isArray(content) && !content.some(block => block?.type === 'tool_result')
      ? content.filter(block => block?.type === 'text').map(block => block.text).join('\n')
      : ''
  const text = typed.trim()
  return text.startsWith('<') ? '' : text
}
// The text Claude wrote in an assistant row, leaving out tool calls and thinking.
export function replyOf(row) {
  const content = row.message?.content
  if (!Array.isArray(content)) return ''
  return content.filter(block => block?.type === 'text' && block.text).map(block => block.text).join('\n').trim()
}

function newTranscript(filePath) {
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
function noteTaskNotifications(transcript, text, time) {
  if (!text.includes('<task-notification>')) return
  for (const block of text.split('<task-notification>').slice(1)) {
    const id = block.match(/<task-id>([^<]+)<\/task-id>/)?.[1]?.trim()
    const shell = id && transcript.shells.get(id)
    if (!shell || shell.endedAt) continue
    shell.endedAt = time || Date.now()
    shell.status = block.match(/<status>([^<]+)<\/status>/)?.[1]?.trim() || 'completed'
  }
}
// Stopping a background shell (TaskStop, or the older KillShell/KillBash) sends no
// task notification, so the stop call itself ends the shell.
const SHELL_STOP_TOOLS = new Set(['TaskStop', 'KillShell', 'KillBash'])
function noteShellStopped(transcript, input, time) {
  const shell = transcript.shells.get(String(input.task_id || input.shell_id || input.bash_id || ''))
  if (!shell || shell.endedAt) return
  shell.endedAt = time || Date.now()
  shell.status = 'stopped'
}
// A Bash call sent to the background answers with its task id and output file.
function noteBackgroundShell(transcript, row, time) {
  const taskId = row.toolUseResult?.backgroundTaskId
  if (!taskId || transcript.shells.has(taskId)) return
  const result = (row.message.content || []).find(block => block?.type === 'tool_result')
  const call = (result && transcript.bashInputs.get(result.tool_use_id)) || {}
  const text = typeof result?.content === 'string' ? result.content : Array.isArray(result?.content) ? result.content.map(part => part?.text || '').join('\n') : ''
  transcript.shells.set(taskId, {
    id: String(taskId),
    command: String(call.command || '').slice(0, 400),
    description: String(call.description || '').slice(0, 160),
    startedAt: time || Date.now(),
    endedAt: 0,
    status: 'running',
    outputFile: text.match(/Output is being written to: (\S+?\.output)\b/)?.[1] || '',
  })
  if (transcript.shells.size > SHELLS_KEPT) transcript.shells.delete(transcript.shells.keys().next().value)
}

function ingestRow(transcript, row) {
  if (row.cwd) transcript.cwd = row.cwd
  if (row.gitBranch) transcript.branch = row.gitBranch
  if (row.type === 'custom-title' && row.customTitle) transcript.title = row.customTitle
  // Each typed prompt records the permission mode it was sent under.
  if (row.permissionMode && !row.isSidechain && !transcript.isSubagent) transcript.permissionMode = String(row.permissionMode)
  if (row.type === 'agent-name' && row.agentName) transcript.agentName = String(row.agentName)
  const time = row.timestamp ? Date.parse(row.timestamp) : 0
  if (time) {
    if (!transcript.firstAt) transcript.firstAt = time
    transcript.lastAt = Math.max(transcript.lastAt, time)
  }
  const message = row.message
  if (row.type === 'queue-operation' && typeof row.content === 'string' && !transcript.isSubagent) noteTaskNotifications(transcript, row.content, time)
  if (row.type === 'user' && message) {
    if (time) transcript.activeMinutes.add(Math.floor(time / 60000))
    if (!row.isSidechain && !transcript.isSubagent) {
      if (row.toolUseResult?.backgroundTaskId) noteBackgroundShell(transcript, row, time)
      if (row.origin?.kind === 'task-notification') noteTaskNotifications(transcript, typeof message.content === 'string' ? message.content : JSON.stringify(message.content), time)
    }
    const text = typedPromptOf(row)
    if (text) {
      transcript.prompts++
      if (!transcript.firstPrompt) transcript.firstPrompt = text.slice(0, 200)
      transcript.lastPrompt = text.slice(0, 2000)
      transcript.lastPromptAt = time
    }
    return
  }
  if (row.type !== 'assistant' || !message) return
  if (time) transcript.activeMinutes.add(Math.floor(time / 60000))
  if (!row.isSidechain && !transcript.isSubagent) {
    const reply = replyOf(row)
    if (reply) {
      transcript.lastReply = reply.slice(0, 6000)
      transcript.lastReplyAt = time
    }
  }
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type !== 'tool_use') continue
    const tool = String(block.name || 'unknown')
    transcript.tools[tool] = (transcript.tools[tool] || 0) + 1
    if (!row.isSidechain && !transcript.isSubagent) {
      transcript.lastTool = tool
      transcript.lastToolAt = time
    }
    const input = block.input || {}
    if (EDIT_TOOLS.has(tool) && (input.file_path || input.notebook_path)) {
      const touched = input.file_path || input.notebook_path
      transcript.filesTouched[touched] = (transcript.filesTouched[touched] || 0) + 1
    }
    if (SHELL_STOP_TOOLS.has(tool) && !row.isSidechain && !transcript.isSubagent) noteShellStopped(transcript, input, time)
    if (tool === 'Bash' && !row.isSidechain && !transcript.isSubagent && block.id) {
      transcript.bashInputs.set(block.id, { command: input.command, description: input.description })
      if (transcript.bashInputs.size > 60) transcript.bashInputs.delete(transcript.bashInputs.keys().next().value)
    }
    if (tool === 'Bash' && /\bgit\s+(-C\s+\S+\s+)?commit\b/.test(String(input.command || ''))) transcript.commits++
    if (tool === 'Bash' && /\bgit\s+(-C\s+\S+\s+)?push\b/.test(String(input.command || ''))) transcript.pushes++
  }
  // Claude Code writes one row per content block of a response, each carrying
  // that response's whole usage: count each response id once.
  const usage = message.usage
  if (!usage || message.model === '<synthetic>') return
  const id = message.id || row.requestId || row.uuid
  if (id && transcript.seenIds.has(id)) return
  if (id) transcript.seenIds.add(id)
  const model = baseModel(message.model)
  if (!row.isSidechain && !transcript.isSubagent) {
    transcript.model = model
    transcript.contextTokens =
      (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0)
  }
  const creation = usage.cache_creation || {}
  const write1h = creation.ephemeral_1h_input_tokens || 0
  const write5m = creation.ephemeral_5m_input_tokens ?? Math.max(0, (usage.cache_creation_input_tokens || 0) - write1h)
  const day = dayKey(time || Date.now())
  const byModel = (transcript.usage[day] ||= {})
  const tokens = (byModel[model] ||= emptyTokens())
  tokens.input += usage.input_tokens || 0
  tokens.output += usage.output_tokens || 0
  tokens.cacheRead += usage.cache_read_input_tokens || 0
  tokens.cacheWrite5m += write5m
  tokens.cacheWrite1h += write1h
  tokens.messages += 1
}

async function readNewLines(transcript, size) {
  const handle = await fsp.open(transcript.filePath, 'r')
  try {
    const chunkSize = 4 * 1024 * 1024
    let carry = ''
    while (transcript.offset < size) {
      const length = Math.min(chunkSize, size - transcript.offset)
      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handle.read(buffer, 0, length, transcript.offset)
      if (!bytesRead) break
      const text = carry + buffer.subarray(0, bytesRead).toString('utf8')
      const lastNewline = text.lastIndexOf('\n')
      if (lastNewline < 0) {
        carry = text
        transcript.offset += bytesRead
        continue
      }
      for (const line of text.slice(0, lastNewline).split('\n')) {
        if (!line || line[0] !== '{') continue
        try {
          ingestRow(transcript, JSON.parse(line))
        } catch {}
      }
      carry = text.slice(lastNewline + 1)
      transcript.offset += bytesRead
    }
    // An unfinished last line is read again next time.
    transcript.offset -= Buffer.byteLength(carry, 'utf8')
  } finally {
    await handle.close()
  }
  // Ids only repeat within one response's rows, which are adjacent: keep the recent ones.
  if (transcript.seenIds.size > 2000) transcript.seenIds = new Set([...transcript.seenIds].slice(-500))
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
        transcripts.delete(full)
        continue
      }
      listed.add(full)
      let transcript = transcripts.get(full)
      if (!transcript || size < transcript.offset) {
        transcript = newTranscript(full)
        transcripts.set(full, transcript)
      }
      if (size > transcript.offset) {
        try {
          await readNewLines(transcript, size)
        } catch (error) {
          log('read failed', full, error.message)
        }
      }
      transcript.size = size
      // A transcript quiet for an hour gets no more rows of a response in progress.
      if (Date.now() - mtimeMs > 60 * 60 * 1000 && transcript.seenIds.size) transcript.seenIds = new Set()
    }
    // Transcripts past the history window, or deleted, leave memory too.
    for (const full of [...transcripts.keys()]) if (!listed.has(full)) transcripts.delete(full)
    transcriptScan.version++
    transcriptScan.readyAt = Date.now()
  } finally {
    transcriptScan.isScanning = false
  }
}
