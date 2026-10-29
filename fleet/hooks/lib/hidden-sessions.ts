// A hidden session (`claude --bg`) has no terminal to ask in: its permission
// prompts and questions go to the dashboard, which shows them in the session's
// chat with buttons, and the answer comes back here. A session in a terminal
// asks there as usual.

import type { EngineInterface, HookOf, MatchedHook } from 'claude-code'

import { callServer } from './server'

const allowedForSession = new Set<string>() // tools allowed for the rest of the session from the page

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

async function isHiddenSession($: EngineInterface): Promise<boolean> {
  return (await sessionMode($)).hidden
}

// Puts one question on the page and waits for its answer, a long poll at a time.
// Undefined when the page cannot be reached or the call was abandoned.
async function askDashboard($: EngineInterface, ask: Record<string, unknown>, signal: AbortSignal): Promise<any> {
  const created = await callServer($, '/api/asks', { sessionId: await $.session.id(), ...ask }).catch(() => undefined)
  if (!created?.id) return undefined
  try {
    while (!signal.aborted) {
      const result = await callServer($, `/api/asks/wait?id=${encodeURIComponent(created.id)}`).catch(() => undefined)
      if (!result || result.status === 'gone') return undefined
      if (result.status === 'answered') return result.answer
    }
    return undefined
  } finally {
    if (signal.aborted) await callServer($, '/api/asks/cancel', { id: created.id }).catch(() => undefined)
  }
}

// A tool that would ask for approval, in a hidden session: allowed or declined
// from the page. Plugin PermissionRequest hooks are not run for these asks, so
// the verdict is caught one step earlier, where the mode and rules settle it.
// In auto mode the classifier settles asks itself, so those are left to it.
export const askPermissionOnDashboard: HookOf<'tool.check'> = async ($, event, next) => {
  const verdict = await next(event)
  if (verdict.decision !== 'ask' || !event.tool_use_id || event.agentId) return verdict
  if (allowedForSession.has(event.tool)) return { ...verdict, decision: 'allow' as const }
  const mode = await sessionMode($)
  if (!mode.hidden || mode.permissionMode === 'auto') return verdict
  const answer = await askDashboard($, { kind: 'permission', toolName: event.tool, toolInput: event.input, reason: verdict.reason ?? '' }, next.signal)
  if (!answer) return verdict
  if (answer.allow && answer.remember) allowedForSession.add(event.tool)
  return answer.allow
    ? { ...verdict, decision: 'allow' as const, reason: 'Allowed from the Fleet dashboard' }
    : { ...verdict, decision: 'deny' as const, reason: answer.message || 'Declined from the Fleet dashboard.' }
}

// A question Claude puts to you, in a hidden session: answered on the page.
export const askQuestionOnDashboard: MatchedHook<'tool.call', { tool: 'AskUserQuestion' }> = async ($, event, next) => {
  if (!(await isHiddenSession($))) return next(event)
  const answer = await askDashboard($, { kind: 'question', toolName: 'AskUserQuestion', questions: event.questions }, next.signal)
  if (!answer) return next(event)
  return { result: { questions: event.questions, answers: answer.answers ?? {}, ...(answer.response ? { response: answer.response } : {}) } }
}
