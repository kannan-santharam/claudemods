// Turning the live sessions into the office: what each is doing, who sits
// where, who goes on a trip, who arrives, waits or leaves, and the ticker
// events for what changed since the last sync.

import { $ } from '../core/dom.js'
import { sessionTree } from '../sessions/tree.js'
import { focusOn } from './camera.js'
import { refreshColors } from './colors.js'
import { DELEGATE_TOOLS, EDIT_TOOLS, LONG_COMMAND_MS, READ_TOOLS, SHELL_TOOLS, TRIP_COOLDOWN_MS, TRIP_MIN_MS, WAIT_ALERT_MS, WEB_TOOLS } from './constants.js'
import { launch } from './effects.js'
import { draw, wake } from './frame.js'
import { firstFree, folderOf, hashOf, outfitOf, truncate } from './helpers.js'
import { buildLayout } from './layout.js'
import { createPerson, leave, retarget, startErrand } from './movement.js'
import { isReduced } from './scene.js'
import { addEvent, chime, renderTicker } from './ticker.js'

function activityOf(session, below) {
  if (session.status === 'waiting') return 'waiting'
  if (session.status === 'busy') {
    const tool = session.lastToolAt && Date.now() - session.lastToolAt < 90_000 ? session.lastTool : ''
    if (EDIT_TOOLS.has(tool)) return 'typing'
    if (READ_TOOLS.has(tool)) return 'reading'
    if (SHELL_TOOLS.has(tool)) return 'terminal'
    if (DELEGATE_TOOLS.has(tool)) return 'supervising'
    return tool ? 'typing' : 'thinking'
  }
  if (below && below.working + below.waiting) return 'supervising'
  return 'idle'
}
// Which trip a working session would like: the globe for web searches,
// the racks to watch a long command.
function tripWanted(session, activity) {
  if (activity === 'reading' && WEB_TOOLS.has(session.lastTool)) return 'globe'
  if (activity === 'terminal' && session.lastToolAt && Date.now() - session.lastToolAt > LONG_COMMAND_MS) return 'racks'
  return ''
}
function noticeChanges(scene, session, person) {
  const before = scene.previous.get(session.sessionId)
  const now = { status: session.status, commits: session.commits || 0, pushes: session.pushes || 0, contextTokens: session.contextTokens || 0, helpers: new Set(session.subagents.filter(agent => agent.isRunning).map(agent => agent.agentId)), shells: new Map((session.shells || []).map(shell => [shell.id, shell])) }
  scene.previous.set(session.sessionId, now)
  if (!before) { if (scene.hasSynced) addEvent(scene, `${session.name} came in`, 'join', session.sessionId); return }
  const desk = scene.layout.deskBySession.get(session.sessionId)
  const from = desk ? { gx: desk.gx, gy: desk.gy - 0.1 } : { gx: person.gx, gy: person.gy }
  if (now.status === 'waiting' && before.status !== 'waiting') { addEvent(scene, `${session.name} needs you`, 'waiting', session.sessionId); chime(scene); setTimeout(() => focusOn(scene, scene.people.get(session.sessionId)), 1200) }
  if (before.status === 'busy' && now.status === 'idle') addEvent(scene, `${session.name} finished`, 'done', session.sessionId)
  if (now.commits > before.commits) { addEvent(scene, `${session.name} committed${session.branch ? ' on ' + session.branch : ''}`, 'commit', session.sessionId); launch(scene, 'parcel', from) }
  if (now.pushes > before.pushes) { addEvent(scene, `${session.name} pushed${session.branch ? ' ' + session.branch : ''}`, 'push', session.sessionId); launch(scene, 'plane', from) }
  if (before.contextTokens > 40_000 && now.contextTokens < before.contextTokens * 0.6 && before.contextTokens - now.contextTokens > 30_000) {
    addEvent(scene, `${session.name} compacted its context`, 'compact', session.sessionId)
    if (person && person.kind === 'session' && now.status !== 'waiting' && !isReduced(scene)) startErrand(scene, person, 'shred', scene.layout.shredSpots, 2600)
  }
  for (const [shellId, shell] of now.shells) {
    if (!before.shells?.has(shellId)) addEvent(scene, `${session.name} started a background shell${shell.description || shell.command ? ': ' + truncate(shell.description || shell.command, 40) : ''}`, 'shell', session.sessionId)
  }
  for (const [shellId, shell] of before.shells || []) {
    if (!now.shells.has(shellId)) addEvent(scene, `${session.name}: background shell finished${shell.description ? ' (' + truncate(shell.description, 36) + ')' : ''}`, 'shell', session.sessionId)
  }
  for (const agentId of now.helpers) {
    if (before.helpers.has(agentId)) continue
    const agent = session.subagents.find(item => item.agentId === agentId)
    addEvent(scene, `${session.name} called a helper${agent?.description ? ': ' + truncate(agent.description, 40) : ''}`, 'helper', session.sessionId)
  }
}
export function sync(scene, live) {
  if (!scene.colors) refreshColors(scene)
  const sessions = live?.sessions || []
  scene.planLimits = (live?.rateLimits || []).filter(limit => typeof limit.percentUsed === 'number')
  const highest = Math.max(0, ...scene.planLimits.map(limit => limit.percentUsed))
  scene.dimming = highest >= 95 ? 0.26 : highest >= 85 ? 0.13 : 0
  scene.liveIds = new Set(sessions.map(session => session.sessionId))
  const { byId, belowOf } = sessionTree(sessions)
  const isRobot = session => !session.tty && !session.hidden
  // Projects in the order they first appeared, members likewise.
  const groupsByKey = new Map()
  for (const session of sessions) {
    if (!scene.memberOrder.has(session.sessionId)) scene.memberOrder.set(session.sessionId, scene.orderCounter++)
    if (isRobot(session)) {
      if (!scene.rackOf.has(session.sessionId)) scene.rackOf.set(session.sessionId, firstFree(scene.rackOf))
      continue
    }
    scene.rackOf.delete(session.sessionId)
    const key = folderOf(session)
    if (!scene.groupOrder.has(key)) scene.groupOrder.set(key, scene.orderCounter++)
    if (!groupsByKey.has(key)) groupsByKey.set(key, { key, label: session.folder || key.split('/').pop() || key, color: scene.colors.shirts[hashOf(key) % scene.colors.shirts.length], members: [] })
    groupsByKey.get(key).members.push(session.sessionId)
  }
  // People still walking out keep their desk until they are gone.
  for (const person of scene.people.values()) {
    if (person.kind !== 'session' || !person.leaving || scene.liveIds.has(person.sessionId) || !person.groupKey) continue
    if (!groupsByKey.has(person.groupKey)) groupsByKey.set(person.groupKey, { key: person.groupKey, label: person.groupLabel, color: scene.colors.shirts[hashOf(person.groupKey) % scene.colors.shirts.length], members: [] })
    groupsByKey.get(person.groupKey).members.push(person.sessionId)
    if (!scene.memberOrder.has(person.sessionId)) scene.memberOrder.set(person.sessionId, scene.orderCounter++)
  }
  for (const key of [...scene.groupOrder.keys()]) if (!groupsByKey.has(key)) scene.groupOrder.delete(key)
  const groups = [...groupsByKey.values()].sort((first, second) => scene.groupOrder.get(first.key) - scene.groupOrder.get(second.key))
  for (const group of groups) group.members.sort((first, second) => scene.memberOrder.get(first) - scene.memberOrder.get(second))
  const nextLayout = buildLayout(groups, Math.max(-1, ...scene.rackOf.values()) + 1)
  const layoutChanged = nextLayout.key !== scene.layout.key || !scene.hasSynced
  if (layoutChanged) scene.layout = nextLayout
  else scene.layout.deskBySession = nextLayout.deskBySession
  // Lounge spots for the idle, kept while they stay idle.
  const activities = new Map(sessions.map(session => [session.sessionId, activityOf(session, belowOf.get(session.sessionId))]))
  for (const [sessionId] of scene.loungeOf) if (activities.get(sessionId) !== 'idle' || isRobot(byId.get(sessionId) || {})) scene.loungeOf.delete(sessionId)
  for (const session of sessions) {
    const key = session.sessionId
    if (!isRobot(session) && activities.get(key) === 'idle' && !scene.loungeOf.has(key) && scene.loungeOf.size < scene.layout.lounge.length) scene.loungeOf.set(key, firstFree(scene.loungeOf))
  }
  pairUpPingPong(scene)
  // Trips for long commands and web searches, kept a little while so nobody paces back and forth.
  const now = Date.now()
  for (const [sessionId, trip] of scene.tripOf) {
    const session = byId.get(sessionId)
    const wanted = session ? tripWanted(session, activities.get(sessionId)) : ''
    if (!session || (wanted !== trip.kind && now - trip.since > TRIP_MIN_MS)) { scene.tripOf.delete(sessionId); const person = scene.people.get(sessionId); if (person) person.tripCooldownUntil = now + TRIP_COOLDOWN_MS }
  }
  for (const session of sessions) {
    if (isRobot(session) || scene.tripOf.has(session.sessionId)) continue
    const kind = tripWanted(session, activities.get(session.sessionId))
    const person = scene.people.get(session.sessionId)
    if (!kind || (person && person.tripCooldownUntil > now)) continue
    const spots = kind === 'globe' ? scene.layout.globeSpots : scene.layout.watchSpots
    const used = new Set([...scene.tripOf.values()].filter(trip => trip.kind === kind).map(trip => trip.slot))
    const slot = spots.findIndex((spot, index) => !used.has(index))
    if (slot >= 0) scene.tripOf.set(session.sessionId, { kind, slot, since: now })
  }
  const wanted = new Set()
  let countAtDesks = 0, countLounge = 0, countHelpers = 0, countRobots = 0, countTrips = 0
  scene.today = { commits: 0, pushes: 0, prompts: 0, working: 0 }
  for (const session of sessions) {
    const key = session.sessionId
    wanted.add(key)
    const robot = isRobot(session)
    let activity = activities.get(key)
    scene.today.commits += session.commits || 0
    scene.today.pushes += session.pushes || 0
    scene.today.prompts += session.prompts || 0
    if (session.status === 'busy') scene.today.working++
    let home
    if (robot) {
      countRobots++
      const rack = scene.layout.racks[scene.rackOf.get(key)] || scene.layout.racks[0]
      home = { gx: rack.gx, gy: rack.gy + 0.95, pose: 'stand', facing: activity === 'waiting' ? 'front' : 'back', zone: 'rack' }
    } else {
      const desk = scene.layout.deskBySession.get(key)
      if (activity === 'waiting') home = { gx: desk.gx + 0.85, gy: desk.gy + 1.0, pose: 'stand', facing: 'front', zone: 'desk' }
      else if (activity === 'supervising' && session.status !== 'busy') home = { gx: desk.gx - 0.05, gy: desk.gy + 1.5, pose: 'stand', facing: 'back', zone: 'desk' }
      else if (activity === 'idle' && scene.loungeOf.has(key)) {
        const spot = scene.layout.lounge[scene.loungeOf.get(key)]
        home = { gx: spot.gx, gy: spot.gy, pose: spot.pose, facing: spot.facing, side: spot.side, zone: 'lounge' }
        countLounge++
      } else {
        if (activity === 'idle') activity = 'relaxing'
        home = { gx: desk.gx, gy: desk.gy + 0.88, pose: 'sit', facing: 'back', zone: 'desk' }
        if (activity !== 'relaxing') countAtDesks++
      }
    }
    let person = scene.people.get(key)
    if (person && person.leaving) { person.leaving = false; person.alpha = Math.max(person.alpha, 0.4) }
    if (!person) {
      const start = scene.hasSynced ? { ...scene.layout.outside, zone: 'open' } : home
      person = createPerson(scene, key, robot ? 'robot' : 'session', key, start)
    }
    person.kind = robot ? 'robot' : 'session'
    person.sessionId = key
    person.session = session
    person.label = session.name
    person.activity = activity
    person.outfit = robot ? '' : outfitOf(session.model)
    person.isAway = activity === 'idle' || activity === 'relaxing'
    person.parentKey = session.parentSessionId && byId.has(session.parentSessionId) ? session.parentSessionId : ''
    person.desk = robot ? null : scene.layout.deskBySession.get(key)
    person.groupKey = robot ? '' : folderOf(session)
    person.groupLabel = session.folder || person.groupKey
    if (activity === 'waiting') {
      if (!scene.waitingSince.has(key)) scene.waitingSince.set(key, scene.hasSynced ? now : Math.min(now, session.updatedAt || now))
    } else scene.waitingSince.delete(key)
    person.isUrgent = activity === 'waiting' && now - (scene.waitingSince.get(key) || now) > WAIT_ALERT_MS
    if (activity === 'waiting' && person.errand) { person.errand = null; person.carrying = '' }
    const trip = !robot && activity !== 'waiting' ? scene.tripOf.get(key) : null
    if (trip) {
      const spot = (trip.kind === 'globe' ? scene.layout.globeSpots : scene.layout.watchSpots)[trip.slot]
      person.trip = { kind: trip.kind, spot: { ...spot, pose: 'stand', facing: 'back', zone: 'utility' } }
      countTrips++
    } else person.trip = null
    noticeChanges(scene, session, person)
    person.home = home
    retarget(scene, person)
    if (robot) continue
    // Running subagents sit on stools around their session's desk.
    const desk = scene.layout.deskBySession.get(key)
    const stools = [[-1.0, 0.25], [1.05, 0.25], [-1.0, 1.0], [1.05, 1.0]]
    session.subagents.filter(agent => agent.isRunning).slice(0, stools.length).forEach((agent, index) => {
      countHelpers++
      const helperKey = key + ':' + agent.agentId
      wanted.add(helperKey)
      let helper = scene.people.get(helperKey)
      if (!helper) helper = createPerson(scene, helperKey, 'helper', helperKey, { gx: person.gx, gy: person.gy, zone: 'desk' })
      helper.shirt = person.shirt
      helper.sessionId = key
      helper.agent = agent
      helper.session = session
      helper.label = agent.description
      helper.activity = 'typing'
      helper.parentKey = key
      const [offsetX, offsetY] = stools[index]
      helper.home = { gx: desk.gx + offsetX, gy: desk.gy + offsetY, pose: 'stool', facing: 'back', zone: 'desk' }
      retarget(scene, helper)
    })
  }
  for (const person of scene.people.values()) {
    if (wanted.has(person.key)) continue
    if (person.kind !== 'helper' && !person.leaving && scene.previous.has(person.sessionId)) { addEvent(scene, `${person.label} left`, 'leave', person.sessionId); scene.previous.delete(person.sessionId) }
    leave(scene, person)
  }
  for (const sessionId of [...scene.memberOrder.keys()]) if (!scene.liveIds.has(sessionId) && !scene.people.has(sessionId)) scene.memberOrder.delete(sessionId)
  scene.hasSynced = true
  const waiting = sessions.filter(session => session.status === 'waiting').length
  const summary = [
    `${countAtDesks} working at desks`, waiting ? `${waiting} waiting for you` : '', `${countLounge} in the lounge`,
    countTrips ? `${countTrips} away from their desk` : '',
    countHelpers ? `${countHelpers} helper${countHelpers > 1 ? 's' : ''} (subagents)` : '', countRobots ? `${countRobots} robot${countRobots > 1 ? 's' : ''} (headless sessions)` : '',
    groups.length ? `${groups.length} project${groups.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ')
  $('#office-hint').textContent = summary
  scene.canvas.setAttribute('aria-label', 'Office view: ' + summary)
  $('#office-dim').hidden = !scene.dimming
  $('#office-dim').textContent = scene.dimming ? `Lights dimmed: a plan window is at ${Math.round(highest)}%` : ''
  renderTicker(scene)
  if (scene.isActive) (isReduced(scene) ? draw(scene) : wake(scene))
}
// Ping-pong needs two: a lone player goes back to standing, and a second
// idle person joins one who is waiting at the table.
function pairUpPingPong(scene) {
  const pongSlots = scene.layout.lounge.map((spot, index) => (spot.pose === 'pong' ? index : -1)).filter(index => index >= 0)
  const holders = pongSlots.map(slot => [...scene.loungeOf].find(([, index]) => index === slot)?.[0])
  if (holders.filter(Boolean).length !== 1) return
  const lonelySlot = pongSlots[holders[0] ? 1 : 0]
  const standing = [...scene.loungeOf].find(([, index]) => scene.layout.lounge[index]?.pose === 'stand')
  if (standing) { scene.loungeOf.set(standing[0], lonelySlot); return }
  const loner = holders.find(Boolean)
  scene.loungeOf.delete(loner)
  const free = scene.layout.lounge.findIndex((spot, index) => spot.pose !== 'pong' && ![...scene.loungeOf.values()].includes(index))
  if (free >= 0) scene.loungeOf.set(loner, free)
}
