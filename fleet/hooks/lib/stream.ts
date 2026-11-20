// The reply as it is written: each piece of text the model streams is passed on
// untouched, and a copy of the text so far goes to the dashboard a few times a
// second, so its chat can show the reply growing as the terminal does. Only the
// session's own replies, and only their text: no thinking, no tool calls.

import type { EngineInterface, StreamHook } from 'claude-code'

import { isThisSessionExcluded } from './excluded'
import { callServer } from './server'

// The wait between two reports. Each carries the whole text so far, so one that
// is skipped or lost costs nothing.
const REPORT_EVERY_MS = 200
// As long as a reply the dashboard's conversation shows.
const REPORT_CHARS = 20000

type Report = { add: (index: number, text: string) => void; end: () => void }

// Reports on the side: the stream never waits for the dashboard, and a
// dashboard that is down costs one refused local request per model request.
function openReport($: EngineInterface, id: string): Report {
  const blocks: string[] = []
  let isReporting = false
  let isWanted = false
  let isDone = false
  let isOff = false
  const report = async (): Promise<void> => {
    if (isReporting || isOff) return
    isReporting = true
    try {
      if (await isThisSessionExcluded($)) {
        isOff = true
        return
      }
      const sessionId = await $.session.id()
      while (isWanted) {
        isWanted = false
        const isLast = isDone
        const answer = await callServer($, '/api/stream', { sessionId, id, text: blocks.filter(Boolean).join('\n').slice(0, REPORT_CHARS), isDone: isLast })
        // A dashboard that refuses is left alone for the rest of this reply.
        if (!answer) isOff = true
        if (isLast || isOff) return
        await $.clock.sleep(REPORT_EVERY_MS)
      }
    } catch {
      // The dashboard went away mid-reply: the transcript still brings the whole message.
      isOff = true
    } finally {
      isReporting = false
    }
  }
  return {
    add(index, text) {
      blocks[index] = (blocks[index] ?? '') + text
      isWanted = true
      void report()
    },
    end() {
      if (!blocks.some(Boolean)) return
      isDone = true
      isWanted = true
      void report()
    },
  }
}

export const streamReply: StreamHook<'turn.step'> = async function* ($, event, next) {
  // A subagent's steps pass straight through.
  if (event.agentId !== undefined) return yield* next(event)
  const report = openReport($, `${event.turnId}:${event.index}`)
  const beneath = next(event)
  try {
    for await (const chunk of beneath) {
      if (chunk.kind === 'text') report.add(chunk.index, chunk.text)
      yield chunk
    }
  } finally {
    // Also when the reply is interrupted: the page stops showing it as being written.
    report.end()
  }
  return await beneath.result
}
