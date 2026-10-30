// A session's conversation, read on demand straight from its transcript: the
// person's prompts and Claude's replies, newest first, a page at a time, and a
// sentence on what it is doing now. Nothing is kept between requests; the
// cursor is a byte offset into the file.

import fsp from 'node:fs/promises'
import { mainTranscriptOf } from './live-view.mjs'
import { toolStarts } from './state.mjs'
import { replyOf, typedPromptOf } from './transcripts.mjs'

const CHUNK_BYTES = 256 * 1024
// One request reads at most this much of a long transcript; the page then ends
// early and the next scroll carries on from where it stopped.
const SCAN_BUDGET_BYTES = 48 * 1024 * 1024
const PROMPT_CHARS = 8000
const REPLY_CHARS = 20000
// Claude's short lines between tool calls ("Reading the config…") are progress,
// not the reply; a turn keeps its last text and any longer ones before it.
const PROGRESS_CHARS = 200
const PAGE_DEFAULT = 10
const PAGE_MAX = 50

function clip(text, limit) {
  return text.length > limit ? text.slice(0, limit) + '\n\n… (cut here, the rest is in the terminal)' : text
}

// The message a transcript line holds, or nothing: rows Claude Code adds for
// itself, tool traffic and subagents' rows are left out.
function messageOf(line) {
  // Most lines are tool results and request records; skip them before parsing.
  if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) return null
  let row
  try { row = JSON.parse(line) } catch { return null }
  if (row.isSidechain) return null
  const at = row.timestamp ? Date.parse(row.timestamp) : 0
  if (row.type === 'user') {
    const text = typedPromptOf(row)
    return text ? { from: 'you', text, at } : null
  }
  if (row.type === 'assistant' && row.message?.model !== '<synthetic>') {
    const text = replyOf(row)
    return text ? { from: 'claude', text, at } : null
  }
  return null
}

// One bubble per turn: consecutive rows from the same side, oldest first.
function turnOf(rows) {
  const ordered = rows.slice().reverse()
  const from = ordered[0].from
  const texts = ordered.map(row => row.text)
  const kept = from === 'claude' ? [...texts.slice(0, -1).filter(text => text.length >= PROGRESS_CHARS), texts.at(-1)] : texts
  return {
    from,
    text: clip(kept.join('\n\n'), from === 'claude' ? REPLY_CHARS : PROMPT_CHARS),
    at: ordered.at(-1).at || ordered[0].at,
    offset: ordered[0].offset,
  }
}

// Up to `limit` whole turns that end before byte `before` (the file's end when
// absent), read backwards in chunks. `before` in the answer is where the next
// older page ends; `hasMore` is false once the start of the file is reached.
export async function readConversation(sessionId, before, limit) {
  const empty = { messages: [], before: 0, hasMore: false }
  const transcript = /^[\w-]{1,100}$/.test(sessionId) ? mainTranscriptOf(sessionId) : null
  if (!transcript) return empty
  const pageSize = Math.min(Math.max(Number.parseInt(limit, 10) || PAGE_DEFAULT, 1), PAGE_MAX)
  let handle
  try {
    handle = await fsp.open(transcript.filePath, 'r')
    const { size } = await handle.stat()
    const cursor = Number.parseInt(before, 10)
    let end = Number.isInteger(cursor) && cursor >= 0 && cursor <= size ? cursor : size
    const turns = []
    let current = []
    let carry = Buffer.alloc(0)
    let scanned = 0
    let isFull = false
    while (end > 0 && !isFull && scanned < SCAN_BUDGET_BYTES) {
      const start = Math.max(0, end - CHUNK_BYTES)
      const chunk = Buffer.alloc(end - start)
      await handle.read(chunk, 0, chunk.length, start)
      scanned += chunk.length
      const joined = Buffer.concat([chunk, carry])
      // The first line may begin in the chunk before; it waits for that one.
      const firstBreak = start > 0 ? joined.indexOf(10) : -1
      if (start > 0 && firstBreak < 0) { carry = joined; end = start; continue }
      carry = start > 0 ? joined.subarray(0, firstBreak) : Buffer.alloc(0)
      // Lines from the last to the first: each ends at a newline, the first one
      // at the chunk's start or just after the carried line.
      const bodyStart = start > 0 ? firstBreak + 1 : 0
      let lineEnd = joined.length
      for (let index = joined.length - 1; index >= bodyStart - 1 && !isFull; index--) {
        if (index >= bodyStart && joined[index] !== 10) continue
        const lineStart = index + 1
        const message = lineEnd > lineStart ? messageOf(joined.toString('utf8', lineStart, lineEnd)) : null
        lineEnd = index
        if (!message) continue
        message.offset = start + lineStart
        if (current.length && current[0].from !== message.from) {
          turns.push(turnOf(current))
          current = []
          isFull = turns.length === pageSize
        }
        if (!isFull) current.push(message)
      }
      end = start
    }
    const reachedStart = end === 0 && !isFull
    // The oldest turn is whole at the start of the file; a turn longer than the
    // read budget is shown in parts rather than never.
    if (current.length && (reachedStart || !turns.length)) turns.push(turnOf(current))
    const messages = turns.reverse()
    // With nothing found inside the budget, the next page starts where this read
    // stopped, the carried line included.
    const nextBefore = messages.length ? messages[0].offset : end + carry.length
    return { messages, before: nextBefore, hasMore: !reachedStart && nextBefore > 0 }
  } catch {
    return empty
  } finally {
    await handle?.close()
  }
}

// What a working session is doing right now, as a sentence a person can read,
// taken from the newest row of its transcript: Claude's own short progress
// line, the description it gave a command, or the file, search or helper a
// tool call names. Never the command itself.
const ACTIVITY_TAIL_BYTES = 512 * 1024
const ACTIVITY_CHARS = 140
const fileName = filePath => String(filePath || '').split('/').filter(Boolean).pop() || ''
const quoted = text => `“${String(text).replace(/\s+/g, ' ').slice(0, 60)}”`
const sentenceCase = text => text.charAt(0).toUpperCase() + text.slice(1)

export function toolActivity(block) {
  const input = block.input || {}
  const name = String(block.name || '')
  switch (name) {
    case 'Bash': return input.description || ''
    case 'Read': return input.file_path ? `Reading ${fileName(input.file_path)}` : ''
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return input.file_path || input.notebook_path ? `Editing ${fileName(input.file_path || input.notebook_path)}` : ''
    case 'Write': return input.file_path ? `Writing ${fileName(input.file_path)}` : ''
    case 'Grep': return input.pattern ? `Searching the code for ${quoted(input.pattern)}` : ''
    case 'Glob': return input.pattern ? `Looking for files matching ${quoted(input.pattern)}` : ''
    case 'WebSearch': return input.query ? `Searching the web for ${quoted(input.query)}` : ''
    case 'WebFetch': try { return `Reading ${new URL(input.url).hostname}` } catch { return '' }
    case 'Agent': case 'Task': return input.description ? `Helper: ${input.description}` : ''
    case 'Skill': return input.skill ? `Using the ${input.skill} skill` : ''
    case 'TodoWrite': return input.activeForm || (input.todos || []).find(todo => todo.status === 'in_progress')?.activeForm || ''
    default: {
      if (input.description) return String(input.description)
      // An MCP tool is named mcp__<server>__<tool>: "Using linear: save issue".
      const [, server, tool] = name.match(/^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/) || []
      return server ? `Using ${server.replace(/^claude_ai_/, '').replace(/_/g, ' ')}: ${tool.replace(/_/g, ' ')}` : name ? `Using ${name}` : ''
    }
  }
}

// A tool the session's mod reported starting, as a sentence. The mod sends only
// the fields toolActivity reads.
export function noteToolStart(sessionId, tool, input) {
  const text = toolActivity({ name: tool, input: input && typeof input === 'object' ? input : {} })
  if (text) toolStarts.set(sessionId, { text: sentenceCase(text.replace(/\s+/g, ' ').trim()).slice(0, ACTIVITY_CHARS), at: Date.now() })
}

// The newer of what the mod reported and what the transcript shows; a prompt
// newer than both means the turn has only just begun.
export async function readActivity(sessionId) {
  const fromTranscript = await transcriptActivity(sessionId)
  const fromMod = toolStarts.get(sessionId)
  return fromMod && fromMod.at > fromTranscript.at ? fromMod : fromTranscript
}

async function transcriptActivity(sessionId) {
  const transcript = /^[\w-]{1,100}$/.test(sessionId) ? mainTranscriptOf(sessionId) : null
  if (!transcript) return { text: '', at: 0 }
  let handle
  try {
    handle = await fsp.open(transcript.filePath, 'r')
    const { size } = await handle.stat()
    const start = Math.max(0, size - ACTIVITY_TAIL_BYTES)
    const tail = Buffer.alloc(size - start)
    await handle.read(tail, 0, tail.length, start)
    const lines = tail.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    for (let index = lines.length - 1; index >= 0; index--) {
      const line = lines[index]
      if (!line.includes('"type":"assistant"') && !line.includes('"type":"user"')) continue
      let row
      try { row = JSON.parse(line) } catch { continue }
      if (row.isSidechain) continue
      const at = row.timestamp ? Date.parse(row.timestamp) : 0
      // A new prompt with nothing after it yet: nothing to say beyond working.
      if (row.type === 'user') { if (typedPromptOf(row)) return { text: '', at }; continue }
      const blocks = Array.isArray(row.message?.content) ? row.message.content : []
      for (const block of blocks.slice().reverse()) {
        const found = block?.type === 'tool_use' ? toolActivity(block) : block?.type === 'text' ? String(block.text || '').trim().split('\n')[0] : ''
        if (found) return { text: sentenceCase(found.replace(/\s+/g, ' ').trim()).slice(0, ACTIVITY_CHARS), at }
      }
    }
    return { text: '', at: 0 }
  } catch {
    return { text: '', at: 0 }
  } finally {
    await handle?.close()
  }
}
