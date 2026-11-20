// Telling the page at once, over one open connection per conversation it shows
// (server-sent events), instead of waiting for its 2-second refresh:
//   changed  the conversation's transcript has new lines, so the page reads it again
//   stream   the reply a connected session is writing right now, as far as it has got
// The page's refresh stays as it is; this only makes it sooner.

import fs from 'node:fs'
import { PAGE_POLICY } from './security.mjs'
import { live, streams } from './state.mjs'
import { mainTranscriptOf, readTranscriptNow, subagentTranscriptOf } from './transcripts.mjs'

const clients = new Set() // { response, sessionId, agentId, watcher, settle, retry, later, keepAlive, shown, changedAt }
const MAX_CLIENTS = 24
// A reply is written as several lines in quick succession: one signal for the lot.
const CHANGE_SETTLE_MS = 40
// A working session writes its transcript many times a second (tool calls and
// their results): the page is told no more often than this.
const CHANGE_EVERY_MS = 600
// A scan holding the transcripts: how soon to look again.
const BUSY_RETRY_MS = 250
// A session's transcript does not exist until its first prompt: look again until it does.
const FIND_RETRY_MS = 3000
const REWATCH_MS = 300
const KEEP_ALIVE_MS = 25000
// As long as a reply the conversation shows (conversation.mjs).
const STREAM_CHARS = 20000
// How long a reply being written is still worth showing to a page that has
// only just connected: one that went quiet was cut off, one that is done is in
// the transcript by now. The page ages what it is sent by the same figures.
const STREAM_DONE_KEEP_MS = 15 * 1000
const STREAM_QUIET_KEEP_MS = 60 * 1000
const isFresh = (stream, now) => now - stream.updatedAt < (stream.isDone ? STREAM_DONE_KEEP_MS : STREAM_QUIET_KEEP_MS)
const isId = text => /^[\w-]{1,100}$/.test(text)

// A page that has stopped reading (a frozen tab) is let go rather than
// buffered for: it reconnects by itself when it wakes.
const MAX_UNREAD_BYTES = 512 * 1024
function write(client, event, data) {
  try {
    client.response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    if (client.response.writableLength > MAX_UNREAD_BYTES) {
      client.response.destroy()
      close(client)
    }
  } catch {}
}

// What a session's conversation shows of its transcript: its prompts and
// replies. Tool traffic changes neither, and is no reason to read it again.
const shownOf = transcript => `${transcript.prompts}:${transcript.lastPromptAt}:${transcript.lastReplyAt}`

// The watched file was written to. A session's own conversation is told only
// when a prompt or a reply has landed; a subagent's, whose replies the scan
// does not date, whenever its file grows. Either way not too often.
async function noteChange(client, transcript) {
  if (!clients.has(client)) return
  if (!client.agentId) {
    if (!(await readTranscriptNow(transcript))) {
      client.settle = setTimeout(() => noteChange(client, transcript), BUSY_RETRY_MS)
      return
    }
    if (shownOf(transcript) === client.shown) return
  }
  const wait = (client.changedAt || 0) + CHANGE_EVERY_MS - Date.now()
  if (wait > 0) {
    client.later ||= setTimeout(() => {
      client.later = null
      noteChange(client, transcript)
    }, wait)
    return
  }
  client.shown = shownOf(transcript)
  client.changedAt = Date.now()
  write(client, 'changed', {})
}

function watchTranscript(client) {
  const transcript = client.agentId ? subagentTranscriptOf(client.sessionId, client.agentId) : mainTranscriptOf(client.sessionId)
  if (!transcript) {
    client.retry = setTimeout(() => watchTranscript(client), FIND_RETRY_MS)
    return
  }
  // A file that was replaced or removed is no longer the one being watched,
  // and a watcher that fails is done: either way, look it up and watch again.
  const again = (waitMs = FIND_RETRY_MS) => {
    client.watcher?.close()
    client.watcher = null
    clearTimeout(client.retry)
    if (clients.has(client)) client.retry = setTimeout(() => watchTranscript(client), waitMs)
  }
  client.shown ??= shownOf(transcript)
  try {
    client.watcher = fs.watch(transcript.filePath, { persistent: false }, eventType => {
      clearTimeout(client.settle)
      client.settle = setTimeout(() => noteChange(client, transcript), CHANGE_SETTLE_MS)
      if (eventType === 'rename') again(REWATCH_MS)
    })
    client.watcher.on('error', () => again())
  } catch {
    again()
  }
}

function close(client) {
  clients.delete(client)
  clearTimeout(client.settle)
  clearTimeout(client.retry)
  clearTimeout(client.later)
  clearInterval(client.keepAlive)
  client.watcher?.close()
}

// The connection the page keeps open for the conversation it shows. Answers
// 'bad' when the ids are not ids and 'full' when every place is taken, and the
// caller sends the refusal: a refused page stays on its 2-second refresh.
export function openEvents(request, response, sessionId, agentId) {
  if (!isId(sessionId) || (agentId && !isId(agentId))) return 'bad'
  if (clients.size >= MAX_CLIENTS) return 'full'
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': PAGE_POLICY,
  })
  response.write('retry: 3000\n\n')
  const client = { response, sessionId, agentId }
  clients.add(client)
  client.keepAlive = setInterval(() => {
    try {
      response.write(': still here\n\n')
    } catch {}
  }, KEEP_ALIVE_MS)
  request.on('close', () => close(client))
  watchTranscript(client)
  const stream = agentId ? null : streams.get(sessionId)
  const now = Date.now()
  if (stream && isFresh(stream, now)) write(client, 'stream', { ...stream, ageMs: now - stream.updatedAt })
  else if (stream) streams.delete(sessionId)
  return 'open'
}

// What a session's mod reports of the reply it is writing: the whole text so
// far each time, so a report that never arrived costs nothing. `id` names the
// model request the text belongs to.
export function noteStream(sessionId, id, text, isDone) {
  // Only a session that is running has a reply to show.
  if (!isId(sessionId) || !id || typeof text !== 'string' || !live.has(sessionId)) return false
  const now = Date.now()
  for (const [key, known] of streams) if (!isFresh(known, now)) streams.delete(key)
  const known = streams.get(sessionId)
  const stream = { id, text: text.slice(0, STREAM_CHARS), isDone, startedAt: known?.id === id ? known.startedAt : now, updatedAt: now }
  streams.set(sessionId, stream)
  for (const client of clients) if (client.sessionId === sessionId && !client.agentId) write(client, 'stream', { ...stream, ageMs: 0 })
  return true
}
