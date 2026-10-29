import type { EngineInterface } from 'claude-code'

import type { FleetSend, FleetSession } from '../../types'
import { callServer, ensureServer, serverState } from './server'
import { writeLastSend } from './state'

// Through the dashboard server, as the page sends: each target takes its own
// message, so no reply comes back to this session.
export async function sendTo($: EngineInterface, targets: FleetSession[], text: string): Promise<void> {
  const message = text.trim()
  if (!message) return
  const now = await $.clock.now()
  const others = targets.filter(target => !target.isSelf)
  let queued = 0
  try {
    if (!serverState.isUp) await ensureServer($)
    const result = await callServer($, '/api/send', { sessionIds: others.map(target => target.sessionId), text: message })
    queued = Number(result?.queued ?? 0)
  } catch {
    queued = 0
  }
  const results: FleetSend[] = others.map(target => ({
    to: target.name,
    text: message,
    isDelivered: queued > 0,
    reason: queued > 0 ? '' : 'the dashboard server did not take it',
    at: now,
  }))
  await writeLastSend($, results)
  $.ui.toast(queued ? `Queued for ${queued} of ${others.length}` : 'Not sent: the dashboard server is not answering')
}

export const INBOX_POLL_MS = 2000

type InboxMessage = {
  id: string
  sessionId: string
  text: string
  mode: 'prompt' | 'command'
  command?: string
  args?: string
}

// The only commands the dashboard may run here: the server checks them too.
const DASHBOARD_COMMANDS = new Set(['model', 'rename', 'compact'])

let isDeliveringInbox = false

export async function deliverInbox($: EngineInterface): Promise<void> {
  // A poll that outlasts its period must not take the same messages twice.
  if (isDeliveringInbox) return
  isDeliveringInbox = true
  try {
    const sessionId = await $.session.id()
    const inbox = await callServer($, `/api/inbox?sessionId=${encodeURIComponent(sessionId)}`)
    for (const message of (inbox?.messages ?? []) as InboxMessage[]) {
      await deliverOne($, message)
    }
  } finally {
    isDeliveringInbox = false
  }
}

// A prompt or command queued here settles only once this session is idle and
// runs it, which can be minutes away: acknowledge on queueing, so the server
// never offers it again, and report a later refusal as a toast.
async function deliverOne($: EngineInterface, message: InboxMessage): Promise<void> {
  const acknowledge = (isDelivered: boolean, reason = '') =>
    callServer($, '/api/inbox/ack', { id: message.id, isDelivered, reason, mode: message.mode })
  if (message.mode === 'command') {
    if (!message.command || !DASHBOARD_COMMANDS.has(message.command)) {
      await acknowledge(false, 'not a dashboard command')
      return
    }
    await acknowledge(true)
    void $.command
      .run({ command: message.command, args: message.args ?? '' })
      .catch(error => $.ui.toast(`Fleet: /${message.command} did not run: ${error instanceof Error ? error.message : String(error)}`))
    return
  }
  if (message.mode === 'prompt') {
    await acknowledge(true)
    // Read as if typed here: a turn of its own once this session is idle.
    void $.prompt
      .submit({ text: message.text, asUser: true })
      .catch(error => $.ui.toast(`Fleet: a message was not submitted: ${error instanceof Error ? error.message : String(error)}`))
    return
  }
  // Only this session's own prompts and commands come here; nothing is relayed.
  await acknowledge(false, 'not a message for this session')
}
