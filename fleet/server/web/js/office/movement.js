// How people move: errands (coffee, a book, the shredder), routes along the
// aisles and the corridor and through the nap room's door, walking to where
// someone belongs, leaving by the door, and making a new person.

import { HAIR_COLORS, LOUNGE_SPLIT_X, LOUNGE_WIDTH, SKIN_TONES } from './constants.js'
import { hashOf } from './helpers.js'
import { isReduced } from './scene.js'

// Short trips away from where someone belongs: coffee, a book from the
// shelf, or the shredder after a compaction. Only while things move.
export function startErrand(scene, person, kind, spots, stayMs) {
  const taken = new Set([...scene.people.values()].filter(other => other !== person && other.errand).map(other => other.errand.key))
  const spot = spots.find(candidate => !taken.has(candidate))
  if (!spot) return false
  person.errand = { kind, spot: { ...spot, pose: 'stand', facing: 'back', zone: spotZone(scene, spot) }, stayMs, phase: 'going', key: spot }
  person.carrying = kind === 'shred' ? 'pile' : kind === 'coffee' && person.activity === 'idle' ? 'mug' : ''
  retarget(scene, person)
  return true
}
export function runErrand(scene, person, now) {
  const errand = person.errand
  if (!errand) return
  if (errand.phase === 'going' && !person.path.length) { errand.phase = 'staying'; errand.until = now + errand.stayMs }
  else if (errand.phase === 'staying' && now > errand.until) {
    errand.phase = 'returning'
    person.carrying = errand.kind === 'fetch' ? 'paper' : errand.kind === 'coffee' ? 'mug' : ''
    retarget(scene, person)
  } else if (errand.phase === 'returning' && !person.path.length) {
    person.errand = null
    person.carrying = ''
  }
}
export function maybeStartErrand(scene, person, seconds) {
  if (person.errand || person.path.length || person.leaving || isReduced(scene) || !seconds) return
  if (person.kind === 'session' && person.activity === 'idle' && person.target?.pose === 'stand' && Math.random() < seconds / 40) {
    startErrand(scene, person, 'coffee', scene.layout.coffeeSpots, 2600)
  } else if (person.kind === 'helper' && Math.random() < seconds / 16) {
    startErrand(scene, person, 'fetch', scene.layout.shelfSpots, 1500)
  }
}
function spotZone(scene, spot) {
  if (spot.gx < LOUNGE_WIDTH) return 'lounge'
  if (spot.gx >= scene.layout.utilityX - 0.3) return 'utility'
  return 'open'
}
function exitX(scene, point, zone) {
  if (zone === 'desk') return point.gx + 1.2
  if (zone === 'rack' || zone === 'utility') return scene.layout.utilityX - 0.25
  // Each half of the lounge has its own aisle, so nobody walks through the
  // nap room to reach the sofa or across the snooker table to reach a spot.
  if (zone === 'lounge') return point.gx < LOUNGE_SPLIT_X ? LOUNGE_SPLIT_X - 0.3 : LOUNGE_WIDTH - 0.3
  if (zone === 'nap') return LOUNGE_WIDTH - 0.3
  return point.gx
}
function route(scene, person, destination) {
  const here = { gx: person.gx, gy: person.gy }
  if (Math.hypot(destination.gx - here.gx, destination.gy - here.gy) < 1.6) return [destination]
  // A room with a door (the nap room) is entered and left through it: its
  // spots carry the way in, and the way out is the way in reversed.
  const wayOut = person.path.length ? [] : [...(person.target?.via || [])].reverse()
  const wayIn = destination.via || []
  const from = wayOut.length ? wayOut[wayOut.length - 1] : here
  const to = wayIn.length ? wayIn[0] : destination
  const corridor = scene.layout.corridorY
  const fromAisle = exitX(scene, from, person.zone), toAisle = exitX(scene, to, destination.zone)
  // Along one aisle there is no need to go round by the corridor.
  const between = Math.abs(fromAisle - toAisle) < 0.05
    ? [{ gx: fromAisle, gy: from.gy }, { gx: toAisle, gy: to.gy }]
    : [{ gx: fromAisle, gy: from.gy }, { gx: fromAisle, gy: corridor }, { gx: toAisle, gy: corridor }, { gx: toAisle, gy: to.gy }]
  const waypoints = [...wayOut, ...between, ...wayIn, destination]
  return waypoints.filter((point, index) => {
    const previousPoint = index ? waypoints[index - 1] : here
    return Math.hypot(point.gx - previousPoint.gx, point.gy - previousPoint.gy) > 0.02
  })
}
function walkTo(scene, person, target) {
  const moved = !person.target || Math.hypot(person.target.gx - target.gx, person.target.gy - target.gy) > 0.02
  if (moved) {
    if (isReduced(scene) || !scene.hasSynced) { person.gx = target.gx; person.gy = target.gy; person.path = [] }
    else person.path = route(scene, person, target)
  }
  person.target = target
  person.zone = target.zone
}
function placeOf(person) {
  if (person.errand && person.errand.phase !== 'returning') return person.errand.spot
  if (person.trip) return person.trip.spot
  return person.home
}
export function retarget(scene, person) {
  const place = placeOf(person)
  if (place) walkTo(scene, person, place)
}
export function leave(scene, person) {
  if (person.leaving) return
  person.leaving = true
  person.errand = null
  person.trip = null
  person.carrying = ''
  person.activity = 'leaving'
  const door = { ...scene.layout.door, zone: 'open' }
  person.path = route(scene, person, door)
  person.path.push({ ...scene.layout.outside })
  person.target = { ...person.target, facing: 'front', pose: 'stand' }
}
export function createPerson(scene, key, kind, seed, start) {
  const hash = hashOf(seed)
  const person = {
    key, kind,
    phase: (hash % 1000) / 160,
    shirt: scene.colors.shirts[hash % scene.colors.shirts.length],
    skin: SKIN_TONES[(hash >> 5) % SKIN_TONES.length],
    hair: HAIR_COLORS[(hash >> 9) % HAIR_COLORS.length],
    size: kind === 'helper' ? 0.68 : 1,
    gx: start.gx, gy: start.gy, path: [], alpha: scene.hasSynced && !isReduced(scene) ? 0 : 1,
    zone: start.zone || 'open', target: null, leaving: false, activity: 'idle', errand: null, trip: null, carrying: '', outfit: '',
  }
  scene.people.set(key, person)
  return person
}
