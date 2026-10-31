// A session's permission prompts and questions, on the dashboard as well: the
// page shows them in the session's chat with buttons, and the answer comes back
// here.
//
// A hidden session (`claude --bg`) has no terminal to ask in, so it waits on the
// page alone. A session in a terminal asks in both places at once and takes
// whichever answers first, and the other side stops waiting:
// - A question is answered by returning the page's answer while the terminal's
//   dialog is still pending: returning with `next` pending aborts what runs
//   beneath, so the dialog closes.
// - A permission prompt is drawn after `tool.check` has returned, inside the
//   `tool.call` around it, so that hook is where the two race. A Deny from the
//   page closes the dialog the same way. An Allow cannot: the tool still has to
//   run, and running it from here would leave the dialog up until it finished,
//   where a second yes would run it twice. So the server presses Return on the
//   dialog's Yes in the session's tab, once it has read the screen and seen that
//   very prompt there (server/lib/terminal-asks.mjs), and this hook goes on
//   waiting for the terminal.
// - Answered in the terminal, the card is cancelled: for a question as soon as
//   the dialog closes; for a permission prompt by the server, which sees the
//   dialog leave the screen, or by this hook once the call ends.
// In auto mode the classifier settles most asks itself. Its card is posted at
// once but held back by the server until the session is seen waiting on that
// dialog, which happens only when the classifier hands the ask to the person; an
// ask it settles ends the call, and the card with it, without ever showing.

import type { EngineInterface, HookOf, MatchedHook } from 'claude-code'

import { reportToolStart } from './activity'
import { callServer } from './server'

const DECLINED = 'Declined from the Fleet dashboard.'

const allowedForSession = new Set<string>() // tools allowed for the rest of the session from the page

// A tool call in a terminal session whose permission prompt tool.check may put
// on the page: tool.check hands the card's id to the tool.call around it, which
// races the page against the dialog. Keyed by tool_use_id.
const callsAwaitingCard = new Map<string, (askId: string | undefined) => void>()

// Whether this session runs hidden, and the permission mode its last prompt was
// sent under (the server reads it from the transcript).
async function sessionMode($: EngineInterface): Promise<{ hidden: boolean; permissionMode: string }> {
  // Asked as soon as the session starts, the dashboard server may still be starting:
  // try a few times over a few seconds before deciding there is no dashboard to ask.
  const sessionId = encodeURIComponent(await $.session.id())
  for (let attempt = 0; attempt < 4; attempt++) {
    const answer = await callServer($, `/api/asks/mode?sessionId=${sessionId}`).catch(() => undefined)
    if (answer) return { hidden: Boolean(answer.hidden), permissionMode: String(answer.permissionMode ?? '') }
    await $.process.run(['/bin/sleep', '1']).catch(() => undefined)
  }
  return { hidden: false, permissionMode: '' }
}

// Puts one question on the page. Undefined when the page cannot be reached.
async function postAsk($: EngineInterface, ask: Record<string, unknown>): Promise<string | undefined> {
  const created = await callServer($, '/api/asks', { sessionId: await $.session.id(), ...ask }).catch(() => undefined)
  return created?.id ? String(created.id) : undefined
}

// Waits for the page's answer, a long poll at a time. Undefined when the page
// cannot be reached, the card was cancelled or the wait abandoned.
async function waitForAnswer($: EngineInterface, askId: string, signal: AbortSignal): Promise<any> {
  while (!signal.aborted) {
    const result = await callServer($, `/api/asks/wait?id=${encodeURIComponent(askId)}`).catch(() => undefined)
    if (!result || result.status === 'gone') return undefined
    if (result.status === 'answered') return result.answer
  }
  return undefined
}

// Takes a card off the page. The server also ends that card's long poll, so the
// wait above returns at once instead of at the end of its poll.
async function cancelAsk($: EngineInterface, askId: string): Promise<void> {
  await callServer($, '/api/asks/cancel', { id: askId }).catch(() => undefined)
}

// The hidden session's way: the page is the only place to answer.
async function askDashboard($: EngineInterface, ask: Record<string, unknown>, signal: AbortSignal): Promise<any> {
  const askId = await postAsk($, ask)
  if (!askId) return undefined
  try {
    return await waitForAnswer($, askId, signal)
  } finally {
    if (signal.aborted) await cancelAsk($, askId)
  }
}

type Settled<Result> = { from: 'terminal'; result: Result } | { from: 'page'; answer: any }

// Runs the terminal's side and the page's side together and settles on whichever
// answers first. The page counts only with a real answer: a card that was never
// posted, could not be, or was cancelled leaves the answer to the terminal. Any
// other ending takes the card off the page.
async function firstAnswer<Result>(
  $: EngineInterface,
  terminal: Promise<Result>,
  card: Promise<string | undefined>,
  signal: AbortSignal,
): Promise<Settled<Result>> {
  const pageWait = new AbortController()
  const abandon = () => pageWait.abort()
  signal.addEventListener('abort', abandon)
  const pageAnswer = card.then(async askId => {
    const answer = askId ? await waitForAnswer($, askId, pageWait.signal) : undefined
    return answer ? ({ from: 'page', answer } as const) : new Promise<never>(() => {})
  })
  let winner: Settled<Result> | undefined
  try {
    winner = await Promise.race([terminal.then(result => ({ from: 'terminal', result }) as const), pageAnswer])
    return winner
  } finally {
    pageWait.abort()
    signal.removeEventListener('abort', abandon)
    if (winner?.from !== 'page') {
      void card.then(askId => {
        if (askId) return cancelAsk($, askId)
      })
    }
  }
}

// tool.check: a tool that would ask for approval. A hidden session waits here for
// the page, since plugin PermissionRequest hooks are not run for its asks and the
// verdict is caught one step earlier, where the mode and rules settle it. A
// session in a terminal posts the card and hands the verdict up exactly as it
// heard it, so the dialog opens as usual (a reworded ask would become this
// plugin's own, which auto mode's classifier no longer settles).
export const askPermissionOnDashboard: HookOf<'tool.check'> = async ($, event, next) => {
  const verdict = await next(event)
  if (verdict.decision !== 'ask' || !event.tool_use_id) return verdict
  if (!event.agentId && allowedForSession.has(event.tool)) return { ...verdict, decision: 'allow' as const }
  const handCardToCall = callsAwaitingCard.get(event.tool_use_id)
  const mode = await sessionMode($)
  const isAutoMode = mode.permissionMode === 'auto'
  if (isAutoMode && mode.hidden) return verdict
  if (mode.hidden) {
    if (event.agentId) return verdict
    const answer = await askDashboard($, { kind: 'permission', toolName: event.tool, toolInput: event.input, reason: verdict.reason ?? '' }, next.signal)
    if (!answer) return verdict
    if (answer.allow && answer.remember) allowedForSession.add(event.tool)
    return answer.allow
      ? { ...verdict, decision: 'allow' as const, reason: 'Allowed from the Fleet dashboard' }
      : { ...verdict, decision: 'deny' as const, reason: answer.message || DECLINED }
  }
  // A question's dialog is the question card's (askQuestionOnDashboard), not a permission.
  if (!handCardToCall || event.tool === 'AskUserQuestion') return verdict
  // In auto mode the server shows it only once the session waits on the dialog.
  handCardToCall(await postAsk($, { kind: 'permission', inTerminal: true, whenWaiting: isAutoMode, toolName: event.tool, toolInput: event.input, reason: verdict.reason ?? '' }))
  return verdict
}

// tool.call around every tool: the permission dialog runs inside `next`, so a
// card tool.check posted for this call races it here.
export const racePermissionDialog: HookOf<'tool.call'> = async ($, event, next) => {
  // The engine takes one catch-all tool.call hook, so this one also tells the
  // dashboard which tool is starting, for the sentence the chat shows.
  reportToolStart($, event)
  const toolUseId = event.tool_use_id
  if (!toolUseId || event.tool === 'AskUserQuestion' || callsAwaitingCard.has(toolUseId)) return next(event)
  let handCard: (askId: string | undefined) => void = () => {}
  const card = new Promise<string | undefined>(resolve => { handCard = resolve })
  callsAwaitingCard.set(toolUseId, handCard)
  const terminal = next(event)
  // Returned from with the dialog pending, `next` is aborted beneath and may reject unheard.
  terminal.catch(() => undefined)
  try {
    const settled = await firstAnswer($, terminal, card, next.signal)
    if (settled.from === 'terminal') return settled.result
    if (!settled.answer.allow) return { deny: settled.answer.message || DECLINED }
    // The server has pressed the dialog's Yes: the tool runs in the terminal's own call.
    if (settled.answer.remember) allowedForSession.add(event.tool)
    return await terminal
  } finally {
    callsAwaitingCard.delete(toolUseId)
    handCard(undefined)
  }
}

// tool.call of AskUserQuestion: a question Claude puts to you, answered on the
// page, or in the terminal's dialog too when the session has one.
export const askQuestionOnDashboard: MatchedHook<'tool.call', { tool: 'AskUserQuestion' }> = async ($, event, next) => {
  const mode = await sessionMode($)
  const question = { kind: 'question', toolName: 'AskUserQuestion', questions: event.questions }
  const resultOf = (answer: any) => ({
    result: { questions: event.questions, answers: answer.answers ?? {}, ...(answer.response ? { response: answer.response } : {}) },
  })
  if (mode.hidden) {
    const answer = await askDashboard($, question, next.signal)
    return answer ? resultOf(answer) : next(event)
  }
  const card = postAsk($, { ...question, inTerminal: true })
  const terminal = next(event)
  terminal.catch(() => undefined)
  const settled = await firstAnswer($, terminal, card, next.signal)
  return settled.from === 'page' ? resultOf(settled.answer) : settled.result
}
