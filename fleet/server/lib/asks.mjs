import crypto from 'node:crypto'
import { SESSION_ID_PATTERN } from './constants.mjs'
import { askWaiters, asks, live, liveCache } from './state.mjs'
import { cleanLine, log } from './utils.mjs'

// A hidden session has no terminal to ask in. The Fleet mod sends its permission
// prompts and questions here; the page shows them in the session's chat with
// buttons; the mod long-polls /api/asks/wait and hands the answer to the session.

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
    found.push({ id: ask.id, kind: ask.kind, toolName: ask.toolName, toolInput: ask.toolInput, reason: ask.reason, questions: ask.questions, createdAt: ask.createdAt })
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
export function answerAsk(body) {
  const ask = asks.get(String(body.id || ''))
  if (!ask) return { ok: false, reason: 'That question is no longer open.' }
  if (ask.answer) return { ok: false, reason: 'It was already answered.' }
  const given = body.answer || {}
  if (ask.kind === 'permission') {
    ask.answer = { allow: given.allow === true, remember: given.allow === true && given.remember === true, message: cleanLine(given.message, 500) }
  } else {
    const answers = {}
    for (const question of ask.questions) {
      const value = given.answers?.[question.question]
      if (typeof value === 'string' && value.trim()) answers[question.question] = value.trim().slice(0, 2000)
    }
    const response = String(given.response || '').trim().slice(0, 4000)
    if (!Object.keys(answers).length && !response) return { ok: false, reason: 'Pick an answer first.' }
    ask.answer = { answers, response }
  }
  for (const done of askWaiters.get(ask.id) || []) done({ status: 'answered', answer: ask.answer })
  askWaiters.delete(ask.id)
  liveCache.at = 0
  // Kept a minute, so a mod that was between polls still collects it.
  setTimeout(() => asks.delete(ask.id), 60_000)
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
}
