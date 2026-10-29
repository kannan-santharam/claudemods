import { esc } from '../core/format.js'
import { state } from '../core/state.js'

// ---------------------------------------------------------------- live --
export const STATUS = {
  waiting: { cls: 'waiting', label: 'Needs input' },
  busy: { cls: 'busy', label: 'Working' },
  idle: { cls: '', label: 'Idle' },
  shell: { cls: 'shell', label: 'Shell' },
}
// A session idle at its prompt while its child sessions or subagents work is
// not idle in any useful sense: it shows as Delegating, with who is working.
export function statusPill(session, below = { working: 0, waiting: 0 }) {
  const isQuiet = session.status === 'idle' || session.status === 'shell'
  const busyBelow = below.working + below.waiting
  if (isQuiet && busyBelow) {
    const detail = [below.working ? `${below.working} working` : '', below.waiting ? `${below.waiting} waiting` : ''].filter(Boolean).join(', ')
    return `<span class="pill delegating ${below.waiting ? 'needs' : ''}" title="Idle itself; below it: ${esc(detail)}"><i class="dot"></i>Delegating</span>`
  }
  const look = STATUS[session.status] || { cls: '', label: session.status || 'Unknown' }
  const label = session.status === 'waiting' && session.waitingFor ? session.waitingFor : look.label
  return `<span class="pill ${look.cls}"><i class="dot"></i>${esc(label.charAt(0).toUpperCase() + label.slice(1))}</span>`
}
export function lastDelivery(sessionId) {
  const list = (state.live?.deliveries || []).filter(d => d.sessionId === sessionId)
  return list[list.length - 1]
}
// Sessions another session started (a `claude -p` run, a tool's agent) sit
// under it, with each session's subagents, so the tree shows who runs what.
// belowOf counts what works under each session, all the way down: running
// subagents and the child sessions (and theirs) working or waiting for you.
// Rows keep their place: sorted by name (then start time), never by status, so a
// session going busy or idle does not make the table jump.
export const byName = (first, second) =>
  String(first.name || '').localeCompare(String(second.name || ''), undefined, { sensitivity: 'base', numeric: true }) ||
  (first.startedAt || 0) - (second.startedAt || 0) || String(first.sessionId).localeCompare(String(second.sessionId))
export function sessionTree(sessions) {
  const byId = new Map(sessions.map(s => [s.sessionId, s]))
  const childrenOf = new Map()
  const roots = []
  for (const s of sessions.slice().sort(byName)) {
    const parent = s.parentSessionId
    if (parent && parent !== s.sessionId && byId.has(parent)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, [])
      childrenOf.get(parent).push(s)
    } else roots.push(s)
  }
  const belowOf = new Map()
  const countBelow = (s, depth = 0) => {
    if (belowOf.has(s.sessionId)) return belowOf.get(s.sessionId)
    const below = { working: (s.subagents || []).filter(a => a.isRunning).length, waiting: 0 }
    belowOf.set(s.sessionId, below)
    if (depth > 5) return below
    for (const child of childrenOf.get(s.sessionId) || []) {
      if (child.status === 'busy') below.working++
      if (child.status === 'waiting') below.waiting++
      const deeper = countBelow(child, depth + 1)
      below.working += deeper.working
      below.waiting += deeper.waiting
    }
    return below
  }
  sessions.forEach(s => countBelow(s))
  return { byId, childrenOf, roots, belowOf }
}
