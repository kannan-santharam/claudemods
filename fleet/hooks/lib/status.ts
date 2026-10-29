import type { EngineInterface } from 'claude-code'

import { callServer } from './server'

export const HEARTBEAT_MS = 3000

export async function heartbeat($: EngineInterface): Promise<void> {
  const [sessionId, model, usage, turns] = await Promise.all([
    $.session.id(),
    $.session.model(),
    $.session.usage(),
    $.session.turns(),
  ])
  await callServer($, '/api/heartbeat', {
    sessionId,
    cwd: await $.session.cwd(),
    model,
    context: usage.context,
    costUsd: usage.cost?.usd,
    turns,
    rateLimits: usage.rateLimits,
  })
}
