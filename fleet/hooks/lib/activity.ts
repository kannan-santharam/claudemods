// What this session is doing: each tool call is reported to the dashboard as it
// starts, so the page can say it in a sentence. The transcript only gets a call
// once it has finished, which is a step too late for that.

import type { EngineInterface, ToolCallInput } from 'claude-code'

import { isThisSessionExcluded } from './excluded'
import { callServer } from './server'

// Only the fields a sentence is made from, never a file's content or a command.
// The tool's arguments sit on the event itself, beside `tool`.
const SENTENCE_FIELDS = ['description', 'file_path', 'notebook_path', 'pattern', 'query', 'url', 'skill'] as const

function sentenceInput(input: unknown): Record<string, string> {
  const fields = (input ?? {}) as Record<string, unknown>
  const picked: Record<string, string> = {}
  for (const field of SENTENCE_FIELDS) if (typeof fields[field] === 'string') picked[field] = (fields[field] as string).slice(0, 200)
  const todos = Array.isArray(fields.todos) ? (fields.todos as Array<{ status?: string; activeForm?: string }>) : []
  const current = todos.find(todo => todo?.status === 'in_progress')?.activeForm
  if (typeof current === 'string') picked.activeForm = current.slice(0, 200)
  return picked
}

// Sent on the side: the tool never waits for the dashboard, and a dashboard
// that is down costs one refused local request.
export function reportToolStart($: EngineInterface, event: ToolCallInput): void {
  void (async () => {
    if (await isThisSessionExcluded($)) return
    await callServer($, '/api/activity', { sessionId: await $.session.id(), tool: event.tool, input: sentenceInput(event) })
  })().catch(() => undefined)
}
