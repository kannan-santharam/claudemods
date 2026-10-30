// A session's conversation, read on demand straight from its transcript: the
// person's prompts and Claude's replies, newest first, a page at a time. Nothing
// is kept between requests; the cursor is a byte offset into the file.

import fsp from 'node:fs/promises'
import { mainTranscriptOf } from './live-view.mjs'
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
