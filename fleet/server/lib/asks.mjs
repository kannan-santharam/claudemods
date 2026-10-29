// Permission prompts and questions from sessions. The Fleet mod sends them here;
// the page shows them in the session's chat with buttons; the mod long-polls
// /api/asks/wait and hands the answer to the session. A hidden session asks
// only here. A session in a terminal asks in its dialog too (`inTerminal`), and
// whichever is answered first counts: an Allow for its permission prompt is
// given in that dialog (terminal-asks.mjs), and a prompt answered there takes
// its card away.

import crypto from 'node:crypto'
import { SESSION_ID_PATTERN } from './constants.mjs'
import { askWaiters, asks, live, liveCache } from './state.mjs'
import { answerInTerminal, watchTerminalPrompts } from './terminal-asks.mjs'
import { cleanLine, log } from './utils.mjs'

const ASK_WAIT_MS = 25_000
const ASK_TTL_MS = 12 * 60 * 60 * 1000

function boundedInput(value) {
  try {
    const text = JSON.stringify(value ?? {})
    return text.length <= 20_000 ? JSON.parse(text) : { truncated: text.slice(0, 20_000) }
  } catch {
    return {}
  }
}
function cleanQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).slice(0, 4).map(question => ({
    question: String(question?.question || '').slice(0, 1000),
    header: String(question?.header || '').slice(0, 40),
    multiSelect: question?.multiSelect === true,
    options: (Array.isArray(question?.options) ? question.options : []).slice(0, 6).map(option => ({
      label: String(option?.label || '').slice(0, 200),
      description: String(option?.description || '').slice(0, 600),
    })),
  })).filter(question => question.question)
}
export function createAsk(body) {
  const sessionId = String(body.sessionId || '')
  if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'Not a session id.' }
  const kind = body.kind === 'question' ? 'question' : 'permission'
  const id = crypto.randomUUID()
  asks.set(id, {
    id,
    sessionId,
    kind,
    inTerminal: body.inTerminal === true,
    toolName: cleanLine(body.toolName, 80) || (kind === 'question' ? 'AskUserQuestion' : 'a tool'),
    toolInput: kind === 'permission' ? boundedInput(body.toolInput) : {},
    suggestions: Array.isArray(body.suggestions) ? boundedInput(body.suggestions.slice(0, 6)) : [],
    questions: kind === 'question' ? cleanQuestions(body.questions) : [],
    reason: cleanLine(body.reason, 300),
    createdAt: Date.now(),
    answer: null,
  })
  liveCache.at = 0
  log('ask', kind, sessionId.slice(0, 8), body.toolName || '')
  return { ok: true, id }
}
export function pendingAsks(sessionId) {
  const found = []
  for (const ask of asks.values()) {
    if (ask.sessionId !== sessionId || ask.answer) continue
    found.push({ id: ask.id, kind: ask.kind, inTerminal: ask.inTerminal, toolName: ask.toolName, toolInput: ask.toolInput, reason: ask.reason, questions: ask.questions, createdAt: ask.createdAt })
  }
  return found.sort((left, right) => left.createdAt - right.createdAt)
}
export function waitForAnswer(id) {
  const ask = asks.get(id)
  if (!ask) return Promise.resolve({ status: 'gone' })
  if (ask.answer) return Promise.resolve({ status: 'answered', answer: ask.answer })
  return new Promise(resolve => {
    const waiters = askWaiters.get(id) || new Set()
    askWaiters.set(id, waiters)
    const done = result => { clearTimeout(timer); waiters.delete(done); resolve(result) }
    const timer = setTimeout(() => done({ status: 'pending' }), ASK_WAIT_MS)
    waiters.add(done)
  })
}
// Records the answer and hands it to the mod's long poll.
function settleAsk(ask, answer) {
  ask.answer = answer
  for (const done of askWaiters.get(ask.id) || []) done({ status: 'answered', answer })
  askWaiters.delete(ask.id)
  liveCache.at = 0
  // Kept a minute, so a mod that was between polls still collects it.
  setTimeout(() => asks.delete(ask.id), 60_000)
}
export async function answerAsk(body) {
  const ask = asks.get(String(body.id || ''))
  if (!ask) return { ok: false, reason: 'That question is no longer open.' }
  if (ask.answer || ask.isAnswering) return { ok: false, reason: 'It was already answered.' }
  const given = body.answer || {}
  if (ask.kind === 'permission') {
    const answer = { allow: given.allow === true, remember: given.allow === true && given.remember === true, message: cleanLine(given.message, 500) }
    if (!ask.inTerminal) {
      settleAsk(ask, answer)
      return { ok: true }
    }
    // Held while its tab is read and typed into, so a second click waits its turn.
    // An Allow is recorded just before Yes is pressed: the tool may then run and end,
    // and the mod take the card off, before this call returns.
    ask.isAnswering = true
    let delivered
    try {
      delivered = await answerInTerminal(ask, answer, () => settleAsk(ask, answer))
    } finally {
      ask.isAnswering = false
    }
    if (!delivered.ok) {
      if (delivered.isGone) cancelAsk({ id: ask.id })
      return { ok: false, reason: delivered.reason }
    }
    if (ask.answer) return { ok: true }
    if (!asks.has(ask.id)) return { ok: false, reason: 'It was already answered in its terminal.' }
    settleAsk(ask, answer)
    return { ok: true }
  }
  const answers = {}
  for (const question of ask.questions) {
    const value = given.answers?.[question.question]
    if (typeof value === 'string' && value.trim()) answers[question.question] = value.trim().slice(0, 2000)
  }
  const response = String(given.response || '').trim().slice(0, 4000)
  if (!Object.keys(answers).length && !response) return { ok: false, reason: 'Pick an answer first.' }
  settleAsk(ask, { answers, response })
  return { ok: true }
}
export function cancelAsk(body) {
  const ask = asks.get(String(body.id || ''))
  if (ask && !ask.answer) asks.delete(ask.id)
  for (const done of askWaiters.get(String(body.id || '')) || []) done({ status: 'gone' })
  askWaiters.delete(String(body.id || ''))
  liveCache.at = 0
  return { ok: true }
}
export function sweepAsks(now = Date.now()) {
  for (const ask of asks.values()) {
    if (!live.has(ask.sessionId) || now - ask.createdAt > ASK_TTL_MS) cancelAsk({ id: ask.id })
  }
  void watchTerminalPrompts(cancelAsk).catch(() => undefined)
}
