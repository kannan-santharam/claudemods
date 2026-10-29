// The furniture outside the desks: the lounge with its coffee counter and
// sofa, lamps, plants, the water cooler, the ping-pong table with its rally,
// the snooker table with its turns and rolling balls, the nap room's walls,
// beds, bean bags and night light, and the utility corner's bookshelf,
// globe, printer with outbox and shredder.

import { mix, shade } from './colors.js'
import { SNOOKER_TURN_SECONDS } from './constants.js'
import { hashOf, toScreen } from './helpers.js'
import { block, disc, onFrontFace, polygon, prism } from './primitives.js'
import { isReduced } from './scene.js'
import { drawPlanBoard } from './walls.js'

export function drawLounge(scene) {
  // Counter with the coffee machine in the corner, the plan board, the sofa.
  const colors = scene.colors
  prism(scene, 0.15, 0.2, 0.8, 0.65, 22, 0, colors.wood)
  prism(scene, 0.3, 0.3, 0.45, 0.4, 18, 22, colors.dark)
  const light = toScreen(0.5, 0.7, 34)
  disc(scene, light.x, light.y, 1.3, 1.3, colors.critical)
  scene.lights.push({ x: light.x, y: light.y, radius: 18, strength: 0.6, warm: false })
  const mug = toScreen(0.72, 0.62, 22)
  block(scene, mug.x - 2, mug.y - 4, 4, 4, 1, colors.label)
  drawPlanBoard(scene)
  prism(scene, 1.15, 1.4, 2.7, 0.32, 26, 0, colors.sofa)
  prism(scene, 1.15, 1.72, 2.7, 0.62, 11, 0, colors.sofa)
  prism(scene, 1.0, 1.4, 0.18, 0.94, 17, 0, colors.sofa)
  prism(scene, 3.85, 1.4, 0.18, 0.94, 17, 0, colors.sofa)
  // Cushions.
  prism(scene, 1.35, 1.48, 0.5, 0.16, 12, 14, [mix(colors.sofa[0], colors.label, 0.45), mix(colors.sofa[1], colors.label, 0.4), mix(colors.sofa[2], colors.label, 0.35)])
  prism(scene, 3.15, 1.48, 0.5, 0.16, 12, 14, [mix(colors.shirts[3], colors.label, 0.3), shade(colors.shirts[3], 0.1), shade(colors.shirts[3], 0.2)])
}
export function drawFloorLamp(scene, gx, gy) {
  const colors = scene.colors
  prism(scene, gx - 0.12, gy - 0.12, 0.24, 0.24, 2, 0, colors.dark)
  prism(scene, gx - 0.02, gy - 0.02, 0.04, 0.04, 42, 2, colors.dark)
  const shadeTop = toScreen(gx, gy, 54)
  const lit = scene.nightness > 0.3
  polygon(scene, [{ x: shadeTop.x - 6, y: shadeTop.y }, { x: shadeTop.x + 6, y: shadeTop.y }, { x: shadeTop.x + 9, y: shadeTop.y + 10 }, { x: shadeTop.x - 9, y: shadeTop.y + 10 }], lit ? '#f7e2b5' : mix(colors.label, colors.wood[0], 0.4))
  if (lit) scene.lights.push({ x: shadeTop.x, y: shadeTop.y + 40, radius: 95, strength: 0.85, warm: true })
}
export function drawWaterCooler(scene, gx, gy) {
  const colors = scene.colors
  prism(scene, gx - 0.2, gy - 0.2, 0.4, 0.4, 24, 0, colors.metal)
  const bottle = toScreen(gx, gy, 24)
  block(scene, bottle.x - 5, bottle.y - 13, 10, 13, 4, colors.isDark ? 'rgba(110,170,230,.7)' : 'rgba(120,180,240,.75)')
  block(scene, bottle.x - 1.5, bottle.y - 16, 3, 3, 1, colors.isDark ? '#6aa0d8' : '#78b4f0')
}
export function drawPingPong(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const table = { gx: 1.55, gy: 3.42, width: 1.95, depth: 0.95 }
  for (const [legX, legY] of [[0.1, 0.1], [1.8, 0.1], [0.1, 0.8], [1.8, 0.8]]) prism(scene, table.gx + legX, table.gy + legY, 0.05, 0.05, 15, 0, colors.dark)
  prism(scene, table.gx, table.gy, table.width, table.depth, 1.6, 15, colors.table)
  const lineFrom = toScreen(table.gx, table.gy + table.depth / 2, 16.7), lineTo = toScreen(table.gx + table.width, table.gy + table.depth / 2, 16.7)
  pen.strokeStyle = 'rgba(255,255,255,.75)'; pen.lineWidth = 0.6
  pen.beginPath(); pen.moveTo(lineFrom.x, lineFrom.y); pen.lineTo(lineTo.x, lineTo.y); pen.stroke()
  // The net across the middle.
  const middle = table.gx + table.width / 2
  polygon(scene, [toScreen(middle, table.gy - 0.05, 16.6), toScreen(middle, table.gy + table.depth + 0.05, 16.6), toScreen(middle, table.gy + table.depth + 0.05, 22), toScreen(middle, table.gy - 0.05, 22)], 'rgba(240,240,240,.7)', colors.dark[1])
  // A rally while both ends are taken.
  const players = [...scene.people.values()].filter(person => person.target?.pose === 'pong' && !person.path.length && !person.leaving)
  if (players.length === 2 && !isReduced(scene)) {
    const travel = (Math.sin(scene.clockSeconds * 2.6) + 1) / 2
    const gx = table.gx + 0.2 + travel * (table.width - 0.4)
    const bounce = Math.abs(Math.sin(scene.clockSeconds * 5.2)) * 14
    const ball = toScreen(gx, table.gy + table.depth / 2 + 0.05, 18 + bounce)
    disc(scene, ball.x, ball.y, 1.6, 1.6, '#ffffff')
    const ground = toScreen(gx, table.gy + table.depth / 2 + 0.05, 16.8)
    disc(scene, ground.x, ground.y, 1.6, 0.7, 'rgba(0,0,0,.25)')
  }
}
export function drawPlant(scene, gx, gy, size = 1) {
  const colors = scene.colors
  prism(scene, gx - 0.18 * size, gy - 0.18 * size, 0.36 * size, 0.36 * size, 12 * size, 0, colors.pot)
  const center = toScreen(gx, gy, 24 * size)
  for (const [offsetX, offsetY, radius] of [[-5, 2, 7], [5, 1, 7], [0, -6, 8], [-2, 5, 6], [3, -1, 6]]) disc(scene, center.x + offsetX * size, center.y + offsetY * size, radius * size, radius * 0.85 * size, colors.leaf)
  disc(scene, center.x - 2 * size, center.y + 1 * size, 3 * size, 2.4 * size, colors.leafDark)
}
export function drawTallPlant(scene, gx, gy) {
  const pen = scene.pen
  const colors = scene.colors
  prism(scene, gx - 0.2, gy - 0.2, 0.4, 0.4, 16, 0, colors.pot)
  const base = toScreen(gx, gy, 16)
  pen.strokeStyle = colors.leafDark; pen.lineWidth = 1.2
  for (const [angle, length] of [[-0.5, 30], [0.1, 38], [0.6, 28], [-0.15, 24], [0.35, 34]]) {
    pen.beginPath(); pen.moveTo(base.x, base.y); pen.lineTo(base.x + Math.sin(angle) * length, base.y - Math.cos(angle) * length); pen.stroke()
    disc(scene, base.x + Math.sin(angle) * length, base.y - Math.cos(angle) * length, 6, 3.4, colors.leaf)
    disc(scene, base.x + Math.sin(angle) * length * 0.6, base.y - Math.cos(angle) * length * 0.6, 4.5, 2.6, colors.leafDark)
  }
}
export function drawBookshelf(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const { gx, gy } = scene.layout.bookshelf
  prism(scene, gx, gy, 1.6, 0.42, 50, 0, colors.wood)
  onFrontFace(scene, gx, gy + 0.42, 1.6, 0, 50, () => {
    for (let shelf = 0; shelf < 4; shelf++) {
      const bottom = 0.05 + shelf * 0.235
      pen.fillStyle = shade(colors.wood[2], 0.25)
      pen.fillRect(0.03, bottom, 0.94, 0.2)
      let cursor = 0.05
      for (let book = 0; cursor < 0.93; book++) {
        const bookSeed = hashOf('book' + shelf + ':' + book)
        const width = 0.035 + (bookSeed % 4) * 0.012
        const height = 0.12 + ((bookSeed >> 4) % 6) * 0.012
        pen.fillStyle = bookSeed % 5 === 0 ? colors.label : colors.shirts[(bookSeed >> 8) % colors.shirts.length]
        if (cursor + width < 0.95) pen.fillRect(cursor, bottom, width, height)
        cursor += width + 0.006 + ((bookSeed >> 12) % 9 === 0 ? 0.05 : 0)
      }
    }
  })
}
export function drawGlobe(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const { gx, gy } = scene.layout.globe
  prism(scene, gx - 0.18, gy - 0.18, 0.36, 0.36, 3, 0, colors.wood)
  prism(scene, gx - 0.02, gy - 0.02, 0.04, 0.04, 20, 3, colors.wood)
  const center = toScreen(gx, gy, 32)
  const spin = isReduced(scene) ? 0 : scene.clockSeconds * (scene.people.size && [...scene.people.values()].some(person => person.trip?.kind === 'globe' && !person.path.length) ? 1.6 : 0.25)
  disc(scene, center.x, center.y, 9, 9, colors.isDark ? '#2f6aa3' : '#5aa0e0')
  pen.save()
  pen.beginPath(); pen.ellipse(center.x, center.y, 9, 9, 0, 0, Math.PI * 2); pen.clip()
  for (let land = 0; land < 4; land++) {
    const x = center.x - 14 + (((land * 9 + spin * 6) % 36) + 36) % 36
    disc(scene, x, center.y - 3 + (land % 2) * 6, 4.5, 3, colors.isDark ? '#4e9a5a' : '#69b86f')
  }
  pen.restore()
  pen.strokeStyle = colors.wood[2]; pen.lineWidth = 1.2
  pen.beginPath(); pen.ellipse(center.x, center.y, 11, 11, 0, -1.2, 1.9); pen.stroke()
}
export function drawPrinter(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const { gx, gy } = scene.layout.printer
  prism(scene, gx, gy, 0.8, 0.6, 18, 0, colors.wood)
  prism(scene, gx + 0.08, gy + 0.08, 0.64, 0.46, 9, 18, colors.metal)
  // The outbox tray on top, holding the parcels that arrived.
  prism(scene, gx + 0.14, gy + 0.14, 0.5, 0.34, 1.5, 27, colors.dark)
  for (let parcel = 0; parcel < Math.min(4, scene.outboxCount); parcel++) {
    prism(scene, gx + 0.18 + (parcel % 2) * 0.22, gy + 0.18, 0.18, 0.16, 5, 28.5 + Math.floor(parcel / 2) * 5, ['#d8b07a', '#c49663', '#b08454'])
  }
  const label = toScreen(gx + 0.4, gy + 0.6, 6)
  pen.fillStyle = colors.muted; pen.font = '600 7px -apple-system, system-ui, sans-serif'; pen.textAlign = 'center'
  pen.fillText('Outbox', label.x + 6, label.y + 2)
}
export function drawShredder(scene) {
  const colors = scene.colors
  const { gx, gy } = scene.layout.shredder
  prism(scene, gx, gy, 0.55, 0.45, 20, 0, colors.dark)
  prism(scene, gx + 0.05, gy + 0.05, 0.45, 0.35, 3, 20, colors.metal)
  const shredding = [...scene.people.values()].some(person => person.errand?.kind === 'shred' && person.errand.phase === 'staying')
  if (shredding && !isReduced(scene)) {
    const mouth = toScreen(gx + 0.27, gy + 0.45, 14)
    for (let strip = 0; strip < 5; strip++) {
      const fall = ((scene.clockSeconds * 22 + strip * 4) % 12)
      block(scene, mouth.x - 5 + strip * 2.2, mouth.y + fall - 6, 1.2, 4, 0.4, colors.paper[0])
    }
  }
  const light = toScreen(gx + 0.45, gy + 0.45, 18)
  disc(scene, light.x, light.y, 1, 1, shredding ? colors.good : colors.metal[2])
}

// Snooker takes turns: every SNOOKER_TURN_SECONDS the other player leans
// over the table to shoot, and the shot is struck a little into the turn.
// Without motion, or without two players, nobody's turn changes.
export function snookerTurn(scene) {
  const players = [...scene.people.values()].filter(person => person.target?.pose === 'snooker' && !person.path.length && !person.leaving)
  const isPlaying = players.length === 2
  if (!isPlaying || isReduced(scene)) return { isPlaying, turn: 0, phase: 0, shooter: isPlaying ? 0 : -1 }
  const turn = Math.floor(scene.clockSeconds / SNOOKER_TURN_SECONDS)
  return { isPlaying, turn, phase: scene.clockSeconds - turn * SNOOKER_TURN_SECONDS, shooter: turn % 2 }
}
const SHOT_AT = 1.6 // seconds into a turn
const easeOut = (from, to, progress) => { const clamped = Math.max(0, Math.min(1, progress)); return from + (to - from) * (1 - (1 - clamped) * (1 - clamped)) }
// Where the cue ball rests at the start of a turn: on the shooter's side,
// side 0 in front and side 1 behind, so each shot sends it across the table.
function cueBallAt(table, turn) {
  const seed = hashOf('snooker-cue:' + turn)
  return { gx: table.gx + 0.35 + ((seed % 1000) / 1000) * (table.width - 0.7), gy: turn % 2 ? table.gy + 0.28 : table.gy + table.depth - 0.28 }
}
// The ball the cue ball strikes, resting in the middle band of the table.
function objectBallAt(table, turn) {
  const seed = hashOf('snooker-object:' + turn)
  return { gx: table.gx + 0.4 + ((seed % 1000) / 1000) * (table.width - 0.8), gy: table.gy + 0.38 + (((seed >> 10) % 100) / 100) * 0.24 }
}
export function drawSnooker(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const table = scene.layout.snooker
  const { gx, gy, width, depth } = table
  for (const [legX, legY] of [[0.08, 0.08], [width - 0.2, 0.08], [0.08, depth - 0.2], [width - 0.2, depth - 0.2], [width / 2 - 0.06, depth - 0.2]]) prism(scene, gx + legX, gy + legY, 0.12, 0.12, 12, 0, colors.rail)
  // The wooden body; its top shows as the rails round the green baize.
  prism(scene, gx, gy, width, depth, 4.5, 12, colors.rail)
  const surface = 17.2
  prism(scene, gx + 0.1, gy + 0.1, width - 0.2, depth - 0.2, 0.6, 16.5, colors.baize)
  // The baulk line and its D, then the six pockets.
  const baulkX = gx + 0.5
  const lineFrom = toScreen(baulkX, gy + 0.1, surface), lineTo = toScreen(baulkX, gy + depth - 0.1, surface)
  pen.strokeStyle = 'rgba(255,255,255,.45)'; pen.lineWidth = 0.5
  pen.beginPath(); pen.moveTo(lineFrom.x, lineFrom.y); pen.lineTo(lineTo.x, lineTo.y); pen.stroke()
  for (const [pocketX, pocketY] of [[0.12, 0.12], [width / 2, 0.1], [width - 0.12, 0.12], [0.12, depth - 0.12], [width / 2, depth - 0.1], [width - 0.12, depth - 0.12]]) {
    const pocket = toScreen(gx + pocketX, gy + pocketY, surface)
    disc(scene, pocket.x, pocket.y, 2.4, 1.4, '#101010')
  }
  const ball = (point, fill) => {
    const center = toScreen(point.gx, point.gy, surface + 1.3)
    disc(scene, center.x, center.y + 1.2, 1.6, 0.7, 'rgba(0,0,0,.3)')
    disc(scene, center.x, center.y, 1.5, 1.5, fill)
    disc(scene, center.x - 0.5, center.y - 0.5, 0.45, 0.45, 'rgba(255,255,255,.7)')
  }
  // The colours on their spots and the reds racked toward the far end.
  ball({ gx: baulkX, gy: gy + depth * 0.32 }, '#e0c22c')
  ball({ gx: baulkX, gy: gy + depth / 2 }, '#8a5a2b')
  ball({ gx: baulkX, gy: gy + depth * 0.68 }, '#2f8f3f')
  ball({ gx: gx + width * 0.72, gy: gy + depth / 2 }, '#e58fb0')
  ball({ gx: gx + width - 0.2, gy: gy + depth / 2 }, '#151515')
  for (const [rowIndex, count] of [[0, 1], [1, 2], [2, 3]]) {
    for (let index = 0; index < count; index++) ball({ gx: gx + width * 0.76 + rowIndex * 0.075, gy: gy + depth / 2 + (index - (count - 1) / 2) * 0.085 }, '#c8262b')
  }
  // The shot: the cue ball runs across to the other side and knocks the blue on a little.
  const { isPlaying, turn, phase, shooter } = snookerTurn(scene)
  const cueStart = cueBallAt(table, turn), cueEnd = cueBallAt(table, turn + 1)
  const objectStart = objectBallAt(table, turn), objectEnd = objectBallAt(table, turn + 1)
  const rolling = (phase - SHOT_AT) / 1.2, knocked = (phase - SHOT_AT - 0.4) / 1.4
  ball({ gx: easeOut(objectStart.gx, objectEnd.gx, knocked), gy: easeOut(objectStart.gy, objectEnd.gy, knocked) }, '#2b5fc0')
  ball({ gx: easeOut(cueStart.gx, cueEnd.gx, rolling), gy: easeOut(cueStart.gy, cueEnd.gy, rolling) }, '#f6f4ec')
  // The shooter's cue, drawn with the table so the baize never covers it: from
  // behind the player's hands to just short of the cue ball, drawn back and
  // forth before the shot and pushed through at it.
  const spot = scene.layout.lounge.find(candidate => candidate.pose === 'snooker' && candidate.side === shooter)
  if (isPlaying && spot) {
    const towardX = cueStart.gx - spot.gx, towardY = cueStart.gy - spot.gy
    const length = Math.hypot(towardX, towardY) || 1
    const unitX = towardX / length, unitY = towardY / length
    const drawnBack = phase < SHOT_AT ? 0.12 + Math.sin(phase * 5) * 0.06 : phase < SHOT_AT + 0.15 ? 0.12 * (1 - (phase - SHOT_AT) / 0.15) : 0
    const tipGap = phase >= SHOT_AT ? 0.03 : 0.08 + drawnBack
    const tip = toScreen(cueStart.gx - unitX * tipGap, cueStart.gy - unitY * tipGap, surface + 1.6)
    const butt = toScreen(spot.gx - unitX * (0.45 + drawnBack), spot.gy - unitY * (0.45 + drawnBack), surface + 9)
    pen.lineCap = 'round'
    pen.strokeStyle = colors.rail[0]; pen.lineWidth = 1.6
    pen.beginPath(); pen.moveTo(butt.x, butt.y); pen.lineTo(tip.x, tip.y); pen.stroke()
    pen.strokeStyle = '#f3e7c9'; pen.lineWidth = 1.1
    pen.beginPath(); pen.moveTo(tip.x + (butt.x - tip.x) * 0.06, tip.y + (butt.y - tip.y) * 0.06); pen.lineTo(tip.x, tip.y); pen.stroke()
    pen.lineCap = 'butt'
  } else if (!isPlaying) {
    // A cue left lying along the rail.
    const from = toScreen(gx + 0.3, gy + depth - 0.05, 16.8), to = toScreen(gx + width - 0.5, gy + depth - 0.05, 16.8)
    pen.strokeStyle = colors.rail[0]; pen.lineWidth = 1.4; pen.lineCap = 'round'
    pen.beginPath(); pen.moveTo(from.x, from.y); pen.lineTo(to.x, to.y); pen.stroke()
    pen.lineCap = 'butt'
  }
}

// The nap room: low partitions so the beds stay in view, a full-height wall
// only on its far (left) side, the beds against the back wall, two bean bags
// by the door and a night light between the beds.
const NAP_WALL_HEIGHT = 46, NAP_RAIL_HEIGHT = 12, NAP_WALL_THICKNESS = 0.1, NAP_SLICE = 0.4
// A partition is drawn in short slices, each at its own depth, because a long
// wall has no single depth: it must hide what is behind it and nothing in front.
function partitionSlices(scene, from, to, along, fixed, height, face) {
  const slices = []
  for (let start = from; start < to - 0.01; start += NAP_SLICE) {
    const length = Math.min(NAP_SLICE, to - start)
    const isLast = start + length >= to - 0.01
    slices.push({
      depth: start + fixed,
      paint: () => {
        const colors = scene.colors
        const top = colors.wallTop, end = mix(face, colors.text, 0.12)
        if (along === 'gy') prism(scene, fixed - NAP_WALL_THICKNESS / 2, start, NAP_WALL_THICKNESS, length, height, 0, [top, isLast ? end : face, face])
        else prism(scene, start, fixed - NAP_WALL_THICKNESS / 2, length, NAP_WALL_THICKNESS, height, 0, [top, face, isLast ? end : face])
      },
    })
  }
  return slices
}
function drawBed(scene, bed, isTaken) {
  const colors = scene.colors
  const { gx, gy, width, depth } = bed
  prism(scene, gx, gy, width, 0.08, 20, 0, colors.wood)
  prism(scene, gx, gy + 0.08, width, depth - 0.08, 6, 0, colors.wood)
  prism(scene, gx + 0.04, gy + 0.1, width - 0.08, depth - 0.14, 4, 6, colors.paper)
  prism(scene, gx + 0.1, gy + 0.14, width - 0.2, 0.32, 2.5, 10, [colors.paper[0], colors.paper[1], colors.paper[2]])
  if (!isTaken) {
    // A folded blanket at the foot of an empty bed.
    const blanket = mix(colors.napWall, colors.accent, 0.35)
    prism(scene, gx + 0.06, gy + depth - 0.45, width - 0.12, 0.36, 2.5, 10, [blanket, shade(blanket, 0.12), shade(blanket, 0.22)])
  }
}
function drawBeanbag(scene, spot, index) {
  const colors = scene.colors
  const fill = mix(['#c98a4b', '#8c6bb1'][index % 2], colors.napWall, colors.isDark ? 0.35 : 0.15)
  const center = toScreen(spot.gx - 0.08, spot.gy - 0.1, 0)
  disc(scene, center.x, center.y, 13, 5.5, colors.shadow)
  disc(scene, center.x, center.y - 6, 12.5, 8, shade(fill, 0.18))
  disc(scene, center.x - 1, center.y - 9, 10.5, 7, fill)
  disc(scene, center.x + 3, center.y - 15, 6.5, 5, mix(fill, '#ffffff', 0.1))
}
function drawNightLight(scene) {
  const colors = scene.colors
  const { gx, gy } = scene.layout.napRoom.nightLight
  prism(scene, gx - 0.16, gy - 0.12, 0.32, 0.26, 11, 0, colors.wood)
  const bulb = toScreen(gx, gy, 15)
  disc(scene, bulb.x, bulb.y + 2, 3.2, 1.4, colors.dark[1])
  disc(scene, bulb.x, bulb.y - 1, 2.6, 3, '#f5c97a')
  scene.lights.push({ x: bulb.x, y: bulb.y + 10, radius: 46, strength: 0.5, warm: true })
}
export function napRoomDrawables(scene) {
  const colors = scene.colors
  const room = scene.layout.napRoom
  const sleepers = new Set([...scene.people.values()].filter(person => person.target?.pose === 'bed' && !person.path.length && !person.leaving).map(person => `${person.target.gx}:${person.target.gy}`))
  const drawables = [
    ...partitionSlices(scene, 0, room.depth, 'gy', room.x0, NAP_WALL_HEIGHT, colors.napWall),
    ...partitionSlices(scene, room.x0, room.doorFrom, 'gx', room.depth, NAP_RAIL_HEIGHT, colors.wallBack),
    ...partitionSlices(scene, room.doorTo, room.x1, 'gx', room.depth, NAP_RAIL_HEIGHT, colors.wallBack),
    ...partitionSlices(scene, 0, room.depth, 'gy', room.x1, NAP_RAIL_HEIGHT, colors.wallLeft),
    { depth: room.nightLight.gx + room.nightLight.gy, paint: () => drawNightLight(scene) },
  ]
  for (const bed of room.beds) {
    const center = { gx: bed.gx + bed.width / 2, gy: bed.gy + 0.8 }
    drawables.push({ depth: center.gx + center.gy - 0.1, paint: () => drawBed(scene, bed, sleepers.has(`${center.gx}:${center.gy}`)) })
  }
  room.beanbags.forEach((beanbag, index) => drawables.push({ depth: beanbag.gx + beanbag.gy - 0.05, paint: () => drawBeanbag(scene, beanbag, index) }))
  return drawables
}
