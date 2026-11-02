// Whether a working session may be going round in circles, read from the tail
// of its transcript by fixed rules: no model reads it and nothing leaves the
// machine. It only flags; what to do about it is the person's call.

import fsp from 'node:fs/promises'
import { mainTranscriptOf, typedPromptOf } from './transcripts.mjs'

const TAIL_BYTES = 1024 * 1024
// The same failure this many times in one turn is a loop, while it is still
// among the last few steps; once the session has moved on, it is not.
const REPEATS = 3
const RECENT_STEPS = 8
// Edits to one file while the checks after them keep failing.
const EDITS = 5
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit'])
// Waiting is not being stuck: sleeps, polls, watching a background shell.
const WAITING_TOOLS = new Set(['TodoWrite', 'BashOutput', 'TaskOutput', 'TaskStop', 'KillShell', 'Monitor', 'ScheduleWakeup'])
// Looking things up: a file or page that is not there is a miss, not a loop.
const LOOKUP_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebFetch', 'WebSearch'])
const WAITING_COMMAND = /(^|[;&|(\s])(sleep|watch|until|while|wait)\s|tail\s+-f/
// The line of an error that names the failure: a thrown error first, then any
// line that says what went wrong.
const THROWN = /\b\w*(Error|Exception)\b:/
const TELLING = /error|fail|cannot|can't|not found|no such|denied|invalid|exception|refused|missing|undefined/i

const fileName = filePath => String(filePath || '').split('/').filter(Boolean).pop() || ''
const clip = (text, limit) => {
  const flat = String(text || '').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat
}
// Text with what changes between two runs of the same thing taken out:
// numbers, hashes, colours and spacing.
const normalised = text =>
  String(text || '')
    .replace(/\u001b\[[\d;]*m/g, '')
    .replace(/0x[\da-f]+|\b[\da-f]{7,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)

function resultText(block) {
  const content = block.content
  if (typeof content === 'string') return content
  return Array.isArray(content) ? content.filter(part => part?.type === 'text').map(part => part.text).join('\n') : ''
}
function errorOf(text) {
  const lines = String(text).split('\n').map(line => line.trim()).filter(line => line && !/^Exit code \d+$/.test(line))
  const line = lines.find(candidate => THROWN.test(candidate)) || lines.find(candidate => TELLING.test(candidate)) || lines[0] || ''
  return { line: clip(line, 160), key: normalised(line) }
}

// One tool call: what makes two calls "the same", and how to name it.
function stepOf(block, at) {
  const input = block.input || {}
  const name = String(block.name || '')
  if (name === 'Bash') {
    const command = String(input.command || '')
    return { name, at, key: 'Bash ' + normalised(command), label: clip(input.description || command, 70), isWaiting: input.run_in_background === true || WAITING_COMMAND.test(command) }
  }
  const file = input.file_path || input.notebook_path || ''
  const target = file ? fileName(file) : clip(input.pattern || input.url || input.query || input.description || '', 50)
  const change = name === 'Edit' ? { from: String(input.old_string ?? ''), to: String(input.new_string ?? '') } : null
  return { name, at, file, change, key: name + ' ' + normalised(file || target), label: target ? `${name} ${target}` : name, isWaiting: WAITING_TOOLS.has(name) }
}

// The steps of the newest turn: every tool call since the last typed prompt,
// each with whether it failed.
function stepsOf(lines) {
  let steps = []
  let byId = new Map()
  for (const line of lines) {
    if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue
    let row
    try { row = JSON.parse(line) } catch { continue }
    if (row.isSidechain) continue
    const at = row.timestamp ? Date.parse(row.timestamp) : 0
    const blocks = Array.isArray(row.message?.content) ? row.message.content : []
    if (row.type === 'user') {
      if (typedPromptOf(row)) {
        steps = []
        byId = new Map()
        continue
      }
      for (const block of blocks) {
        const step = block?.type === 'tool_result' && byId.get(block.tool_use_id)
        if (!step) continue
        const text = resultText(block)
        // Claude Code turned the call down before it ran (a malformed call, a
        // file not read first): it is put right at once, and nothing ran.
        if (block.is_error === true && text.trimStart().startsWith('<tool_use_error>')) { step.isWaiting = true; continue }
        step.isDone = true
        step.isError = block.is_error === true
        if (step.isError) step.error = errorOf(text)
      }
    } else if (row.message?.model !== '<synthetic>') {
      for (const block of blocks) {
        if (block?.type !== 'tool_use') continue
        const step = stepOf(block, at)
        steps.push(step)
        byId.set(block.id, step)
      }
    }
  }
  return steps
}

// Why the turn looks stuck, or null: the same call failing again and again,
// one file edited over and over while its checks keep failing, or the same
// error coming back whatever is tried. `id` stays the same while it is the
// same loop, so the page can tell one it has shown from a new one.
function loopOf(steps) {
  const active = steps.filter(step => step.isDone && !step.isWaiting)
  const isRecent = index => index >= active.length - RECENT_STEPS
  const byCount = (left, right) => right.count - left.count

  const runs = new Map()
  active.forEach((step, index) => {
    const run = runs.get(step.key)
    if (!step.isError) runs.set(step.key, null)
    else runs.set(step.key, { count: (run?.count || 0) + 1, since: run ? run.since : step.at, index, step })
  })
  const failing = [...runs.values()].filter(run => run && run.count >= REPEATS && isRecent(run.index)).sort(byCount)[0]
  if (failing) {
    const { step } = failing
    return { id: clip('call:' + step.key, 160), since: failing.since, reason: `${step.name === 'Bash' ? 'Ran' : 'Tried'} “${step.label}” ${failing.count} times, failing each time`, evidence: step.error.line }
  }

  const edits = new Map()
  active.forEach((step, index) => {
    if (!EDIT_TOOLS.has(step.name) || !step.file || step.isError) return
    const file = edits.get(step.file) || { count: 0, since: step.at, first: index, changes: [], hasUndone: false }
    file.count++
    if (step.change) {
      file.hasUndone ||= file.changes.some(change => change.from === step.change.to && change.to === step.change.from)
      file.changes.push(step.change)
    }
    edits.set(step.file, file)
  })
  for (const [filePath, file] of [...edits].sort((left, right) => byCount(left[1], right[1]))) {
    if (file.count < EDITS && !file.hasUndone) continue
    const checks = active.map((step, index) => ({ step, index })).filter(({ step, index }) => index > file.first && step.name === 'Bash')
    const failed = checks.filter(({ step }) => step.isError).length
    const last = checks.at(-1)
    if (!last?.step.isError || !isRecent(last.index) || failed < (file.hasUndone ? 2 : REPEATS)) continue
    return {
      id: clip('edits:' + filePath, 160),
      since: file.since,
      reason: `Edited ${fileName(filePath)} ${file.count} times${file.hasUndone ? ', undoing one of its own changes,' : ''} and the checks after it keep failing`,
      evidence: last.step.error.line,
    }
  }

  const errors = new Map()
  let lastFailure = -1
  active.forEach((step, index) => {
    if (!step.isError || !step.error.key || LOOKUP_TOOLS.has(step.name)) return
    lastFailure = index
    const error = errors.get(step.error.key) || { count: 0, since: step.at, tries: new Set(), line: step.error.line }
    error.count++
    error.index = index
    error.tries.add(step.key)
    errors.set(step.error.key, error)
  })
  const repeating = [...errors.entries()].filter(([, error]) => error.count >= REPEATS && error.tries.size >= 2 && error.index === lastFailure && isRecent(error.index)).sort((left, right) => byCount(left[1], right[1]))[0]
  if (repeating) {
    const [key, error] = repeating
    return { id: clip('error:' + key, 160), since: error.since, reason: `Hit the same error ${error.count} times across ${error.tries.size} different tries`, evidence: error.line }
  }
  return null
}

export const stuckFromLines = lines => loopOf(stepsOf(lines))

// What each working session's transcript last showed, read again only when the
// file has grown: sessionId -> { size, stuck }.
const found = new Map()

// Every 2 seconds with the registry scan, for the sessions at work.
export async function readStuck(sessionIds) {
  for (const sessionId of sessionIds) {
    const transcript = /^[\w-]{1,100}$/.test(sessionId) ? mainTranscriptOf(sessionId) : null
    if (!transcript || found.get(sessionId)?.size === transcript.size) continue
    found.set(sessionId, { size: transcript.size, stuck: await readTail(transcript.filePath) })
  }
  for (const sessionId of [...found.keys()]) if (!sessionIds.includes(sessionId)) found.delete(sessionId)
}

export const stuckOf = sessionId => found.get(sessionId)?.stuck || null

async function readTail(filePath) {
  let handle
  try {
    handle = await fsp.open(filePath, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const tail = Buffer.alloc(size - start)
    await handle.read(tail, 0, tail.length, start)
    const lines = tail.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    return stuckFromLines(lines)
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}
