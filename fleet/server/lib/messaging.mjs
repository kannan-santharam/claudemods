import { deliveries, live, liveCache, messaging } from './state.mjs'
import { guardLeading } from './typing.mjs'

// The page queues a message here. A connected session's own fleet mod takes it
// as a prompt (or runs its /command); a session without the mod has it typed
// into its Terminal tab by this server once it is idle. Nothing is ever relayed
// through another session.

export function claimFor(claimant) {
  const now = Date.now()
  const claimed = []
  for (const item of messaging.inbox) {
    if (item.claimedAt && now - item.claimedAt < 30000) continue
    // Only the session a message is for takes it. Relaying through another
    // session made that session the sender, and the reply landed there.
    if (item.sessionId !== claimant) continue
    const mode = item.command ? 'command' : 'prompt'
    item.claimedAt = now
    item.claimedBy = claimant
    const text = mode === 'prompt' ? guardLeading(item.text) : item.text
    claimed.push({ id: item.id, sessionId: item.sessionId, text, mode, command: item.command, args: item.args })
  }
  return claimed
}

export function acknowledge(id, result, removed) {
  liveCache.at = 0
  const index = messaging.inbox.findIndex(entry => entry.id === id)
  if (index < 0 && !removed) return
  const item = index >= 0 ? messaging.inbox.splice(index, 1)[0] : removed
  deliveries.push({
    id,
    sessionId: item.sessionId,
    name: live.get(item.sessionId)?.name || item.sessionId.slice(0, 8),
    text: item.text.slice(0, 200),
    at: Date.now(),
    isDelivered: Boolean(result.isDelivered),
    reason: String(result.reason || ''),
    via: result.mode === 'prompt' ? 'prompt' : result.mode === 'command' ? 'command' : result.mode === 'typed' ? 'typed into its tab' : 'message',
  })
  if (deliveries.length > 100) deliveries.splice(0, deliveries.length - 100)
}
