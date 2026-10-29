// People: a session or helper drawn as a person whose outfit says its model
// and whose pose and arms say what it is doing (a snooker player leaning in
// to shoot or waiting with the cue, a napper on a bean bag or tucked up in
// bed), a headless session drawn as a robot, and the hit box each figure
// leaves for the pointer.

import { mix, shade } from './colors.js'
import { snookerTurn } from './furniture.js'
import { toScreen } from './helpers.js'
import { block, disc, polygon, prism } from './primitives.js'
import { isReduced } from './scene.js'

function drawOutfitBack(scene, person, torsoTop, headY, bob) {
  const pen = scene.pen
  const outfit = person.outfit
  if (outfit === 'blazer') {
    block(scene, -5, torsoTop - 0.5, 10, 2.6, 1, shade(person.shirt, 0.3))
    pen.strokeStyle = shade(person.shirt, 0.32); pen.lineWidth = 0.8
    pen.beginPath(); pen.moveTo(0, torsoTop + 15); pen.lineTo(0, torsoTop + 9); pen.stroke()
  } else if (outfit === 'hoodie') {
    disc(scene, bob, torsoTop + 1.5, 6.6, 3.8, shade(person.shirt, 0.16))
  }
}
function drawOutfitFront(scene, person, torsoTop) {
  const pen = scene.pen
  const outfit = person.outfit
  if (outfit === 'blazer') {
    polygon(scene, [{ x: -3.6, y: torsoTop }, { x: 3.6, y: torsoTop }, { x: 0, y: torsoTop + 8 }], '#f4f3ef')
    polygon(scene, [{ x: -0.9, y: torsoTop + 1.5 }, { x: 0.9, y: torsoTop + 1.5 }, { x: 0.6, y: torsoTop + 7 }, { x: 0, y: torsoTop + 8 }, { x: -0.6, y: torsoTop + 7 }], shade(person.shirt, 0.45))
    pen.strokeStyle = shade(person.shirt, 0.3); pen.lineWidth = 0.9
    pen.beginPath(); pen.moveTo(-3.6, torsoTop); pen.lineTo(-1.2, torsoTop + 8.5); pen.moveTo(3.6, torsoTop); pen.lineTo(1.2, torsoTop + 8.5); pen.stroke()
  } else {
    polygon(scene, [{ x: -3, y: torsoTop }, { x: 3, y: torsoTop }, { x: 0, y: torsoTop + 4 }], person.skin)
    if (outfit === 'hoodie') {
      pen.strokeStyle = 'rgba(255,255,255,.8)'; pen.lineWidth = 0.7
      pen.beginPath(); pen.moveTo(-1.6, torsoTop + 2); pen.lineTo(-1.6, torsoTop + 7); pen.moveTo(1.6, torsoTop + 2); pen.lineTo(1.6, torsoTop + 7); pen.stroke()
      block(scene, -4.5, torsoTop + 9, 9, 4, 1.5, shade(person.shirt, 0.12))
    }
  }
}
function drawHeadwear(scene, person, facing, headY, bob) {
  const pen = scene.pen
  const outfit = person.outfit
  if (outfit === 'beanie') {
    const knit = mix(person.shirt, '#ffffff', 0.25)
    pen.beginPath(); pen.ellipse(bob, headY - 1.6, 7.6, 7, 0, Math.PI, Math.PI * 2); pen.fillStyle = knit; pen.fill()
    block(scene, bob - 7.7, headY - 2.6, 15.4, 2.8, 1.2, shade(knit, 0.15))
    disc(scene, bob, headY - 9, 2.1, 2.1, shade(knit, 0.05))
  } else if (outfit === 'headphones') {
    pen.strokeStyle = '#2a2b30'; pen.lineWidth = 1.8
    pen.beginPath(); pen.ellipse(bob, headY - 0.5, 7.6, 8, 0, Math.PI, Math.PI * 2); pen.stroke()
    if (facing === 'front') {
      block(scene, bob - 9.2, headY - 2.4, 3.2, 5.6, 1.4, '#2a2b30')
      block(scene, bob + 6, headY - 2.4, 3.2, 5.6, 1.4, '#2a2b30')
    } else {
      block(scene, bob - 9, headY - 2, 3, 5.4, 1.4, '#2a2b30')
      block(scene, bob + 6, headY - 2, 3, 5.4, 1.4, '#2a2b30')
    }
    disc(scene, bob - 7.6, headY + 0.5, 0.9, 0.9, scene.colors.accent)
  }
}
function drawCarried(scene, person, facing, torsoTop) {
  const colors = scene.colors
  if (person.carrying === 'pile') {
    if (facing === 'front') { for (let sheet = 0; sheet < 4; sheet++) block(scene, -6, torsoTop + 7 - sheet * 1.4, 12, 1.6, 0.4, sheet % 2 ? colors.paper[1] : colors.paper[0]) }
    else { for (let sheet = 0; sheet < 3; sheet++) block(scene, -6, torsoTop - 1 - sheet * 1.4, 12, 1.6, 0.4, sheet % 2 ? colors.paper[1] : colors.paper[0]) }
  } else if (person.carrying === 'paper') {
    block(scene, facing === 'front' ? 5 : -10, torsoTop + 8, 6, 7.5, 0.6, colors.paper[0])
  } else if (person.carrying === 'mug') {
    block(scene, facing === 'front' ? 6 : -10, torsoTop + 9, 4.5, 5, 1, colors.label)
  }
}
function drawHuman(scene, person, facing, pose, mirror) {
  const pen = scene.pen
  const colors = scene.colors
  const time = scene.clockSeconds + person.phase
  const still = isReduced(scene)
  const sitting = pose === 'sit' || pose === 'sofa' || pose === 'stool' || pose === 'beanbag'
  const hipY = pose === 'beanbag' ? -8 : sitting ? -12 : -14
  // The snooker player whose turn it is bends over the table.
  const isShooting = pose === 'snooker' && snookerTurn(scene).shooter === person.target.side
  const breathe = still ? 0 : Math.sin(time * 2) * 0.4
  const shirt = person.shirt, sleeve = shade(person.shirt, 0.12)
  disc(scene, 0, 0, 9, 3.6, colors.shadow)
  if (pose === 'walk') {
    const swing = still ? 0 : Math.sin(time * 11) * 3
    block(scene, -5 + swing * 0.5, hipY, 4, -hipY, 1.5, colors.pants)
    block(scene, 1 - swing * 0.5, hipY, 4, -hipY, 1.5, colors.pants)
  } else if (pose === 'stand' || pose === 'pong' || pose === 'snooker') {
    block(scene, -5, hipY, 4, -hipY, 1.5, colors.pants)
    block(scene, 1, hipY, 4, -hipY, 1.5, colors.pants)
  } else if (pose === 'sofa') {
    block(scene, -6, hipY, 5, 8, 2, colors.pants)
    block(scene, 1, hipY, 5, 8, 2, colors.pants)
  } else if (pose === 'beanbag') {
    block(scene, -7, hipY, 5, 9, 2, colors.pants)
    block(scene, 2, hipY, 5, 9, 2, colors.pants)
  }
  const torsoTop = hipY - 15 + breathe + (isShooting ? 6 : 0)
  const bob = !still && person.activity === 'reading' && sitting ? Math.sin(time * 1.4) * 0.8 : 0
  const headY = torsoTop - 7
  block(scene, -8, torsoTop, 16, 15, 5, shirt)
  if (facing === 'front') drawOutfitFront(scene, person, torsoTop)
  else drawOutfitBack(scene, person, torsoTop, headY, bob)
  // Arms.
  const activity = person.activity
  if (person.carrying === 'pile') {
    block(scene, -11, torsoTop + 2, 4, 9, 2, sleeve)
    block(scene, 7, torsoTop + 2, 4, 9, 2, sleeve)
  } else if (pose === 'pong') {
    block(scene, -11, torsoTop + 2, 4, 12, 2, sleeve)
    const swingAngle = still ? -1.6 : -1.9 + Math.sin(scene.clockSeconds * 2.6 + (person.target.side ? Math.PI : 0)) * 0.6
    pen.save()
    pen.translate(9, torsoTop + 3)
    pen.rotate(swingAngle)
    block(scene, -2, 0, 4, 10, 2, sleeve)
    disc(scene, 0, 13, 3.6, 3.6, colors.critical)
    block(scene, -0.8, 9.5, 1.6, 3, 0.5, colors.wood[2])
    pen.restore()
  } else if (pose === 'snooker') {
    if (isShooting) {
      // Both hands low and forward on the cue (the cue itself is drawn with the table).
      block(scene, -11, torsoTop + 3, 4, 9, 2, sleeve)
      block(scene, 7, torsoTop + 3, 4, 9, 2, sleeve)
    } else {
      // Waiting a turn, the cue held upright at the side.
      block(scene, -11, torsoTop + 2, 4, 12, 2, sleeve)
      pen.strokeStyle = colors.rail[0]; pen.lineWidth = 1.4; pen.lineCap = 'round'
      pen.beginPath(); pen.moveTo(12, -1); pen.lineTo(10.5, torsoTop - 13); pen.stroke()
      pen.strokeStyle = '#f3e7c9'; pen.lineWidth = 1.1
      pen.beginPath(); pen.moveTo(10.6, torsoTop - 11.5); pen.lineTo(10.5, torsoTop - 13); pen.stroke()
      pen.lineCap = 'butt'
      block(scene, 7, torsoTop + 2, 4, 9, 2, sleeve)
      disc(scene, 10.8, torsoTop + 11, 2.2, 2.2, person.skin)
    }
  } else if (facing === 'back' && sitting && ['typing', 'terminal', 'thinking', 'reading', 'supervising'].includes(activity)) {
    const speed = activity === 'terminal' ? 20 : activity === 'typing' ? 15 : 0
    const tapLeft = still || !speed ? 0 : Math.sin(time * speed) * 1.3
    const tapRight = still || !speed ? 0 : Math.sin(time * speed + 2) * 1.3
    block(scene, -11, torsoTop + 2 + tapLeft, 4, 9, 2, sleeve)
    block(scene, 7, torsoTop + 2 + tapRight, 4, 9, 2, sleeve)
  } else if (activity === 'waiting' && facing === 'front' && pose !== 'walk') {
    block(scene, -11, torsoTop + 2, 4, 12, 2, sleeve)
    pen.save()
    pen.translate(9, torsoTop + 3)
    const urgent = person.isUrgent && !still
    pen.rotate(-2.6 + (still ? 0 : Math.sin(time * (urgent ? 11 : 7)) * (urgent ? 0.55 : 0.35)))
    block(scene, -2, 0, 4, 12, 2, sleeve)
    disc(scene, 0, 13, 2.4, 2.4, person.skin)
    pen.restore()
  } else if ((activity === 'idle' && !person.carrying) && facing === 'front' && pose !== 'walk' && pose !== 'beanbag') {
    block(scene, -11, torsoTop + 2, 4, 12, 2, sleeve)
    disc(scene, -9, torsoTop + 15, 2.2, 2.2, person.skin)
    block(scene, 7, torsoTop + 2, 4, 7, 2, sleeve)
    block(scene, 3, torsoTop + 7, 8, 4, 2, sleeve)
    block(scene, 1, torsoTop + 3, 5, 6, 1, '#f7f5f0')
    if (!still) {
      pen.strokeStyle = 'rgba(160,160,160,.5)'
      pen.lineWidth = 0.8
      pen.beginPath()
      const drift = Math.sin(time * 2.5) * 1.2
      pen.moveTo(3.5, torsoTop + 2); pen.quadraticCurveTo(5 + drift, torsoTop - 1, 3 - drift, torsoTop - 4)
      pen.stroke()
    }
  } else {
    const swing = pose === 'walk' && !still ? Math.sin(time * 11) * 2 : 0
    block(scene, -11, torsoTop + 2 - swing * 0.3, 4, 12, 2, sleeve)
    block(scene, 7, torsoTop + 2 + swing * 0.3, 4, 12, 2, sleeve)
    if (facing === 'front') { disc(scene, -9, torsoTop + 15, 2.2, 2.2, person.skin); disc(scene, 9, torsoTop + 15, 2.2, 2.2, person.skin) }
  }
  drawCarried(scene, person, facing, torsoTop)
  // Head.
  disc(scene, bob, headY, 7, 7, person.skin)
  if (facing === 'front') {
    pen.beginPath()
    pen.ellipse(bob, headY - 1.4, 7.4, 6.2, 0, Math.PI, Math.PI * 2)
    pen.fillStyle = person.hair
    pen.fill()
    const look = pose === 'walk' ? (mirror ? -1.6 : 1.6) : 0
    if (pose === 'beanbag') {
      // Asleep: closed eyes.
      pen.strokeStyle = '#1b1b1b'; pen.lineWidth = 0.8
      pen.beginPath(); pen.arc(bob - 2.6, headY + 0.4, 1.3, 0.25, Math.PI - 0.25); pen.stroke()
      pen.beginPath(); pen.arc(bob + 2.6, headY + 0.4, 1.3, 0.25, Math.PI - 0.25); pen.stroke()
    } else {
      disc(scene, bob - 2.6 + look, headY + 0.8, 0.95, 1.1, '#1b1b1b')
      disc(scene, bob + 2.6 + look, headY + 0.8, 0.95, 1.1, '#1b1b1b')
    }
    if (activity === 'idle' && pose !== 'beanbag' && !still && Math.floor(time * 0.7) % 4 === 0) {
      pen.strokeStyle = '#1b1b1b'; pen.lineWidth = 0.7
      pen.beginPath(); pen.arc(bob + look * 0.5, headY + 3, 1.6, 0.2, Math.PI - 0.2); pen.stroke()
    }
  } else {
    disc(scene, bob, headY - 0.4, 7.2, 7, person.hair)
  }
  if (person.kind === 'helper') {
    // Helpers wear a cap in their session's colour.
    pen.beginPath()
    pen.ellipse(bob, headY - 2.2, 7.6, 5.4, 0, Math.PI, Math.PI * 2)
    pen.fillStyle = colors.accent
    pen.fill()
    block(scene, bob + (facing === 'front' ? -6 : -2), headY - 3, 8, 2, 1, shade(colors.accent, 0.2))
  } else {
    drawHeadwear(scene, person, facing, headY, bob)
  }
  if (pose === 'stool') {
    // A laptop on the knees.
    block(scene, -6, hipY - 1, 12, 2, 1, colors.metal[1])
    if (facing === 'back') block(scene, -5, hipY - 8, 10, 7, 1, mix(colors.accent, '#ffffff', 0.25))
  }
}
function drawRobot(scene, person, facing, pose) {
  const pen = scene.pen
  const colors = scene.colors
  const time = scene.clockSeconds + person.phase
  const still = isReduced(scene)
  const [light, middle, deep] = colors.robot
  disc(scene, 0, 0, 9, 3.6, colors.shadow)
  const legSwing = pose === 'walk' && !still ? Math.sin(time * 11) * 2 : 0
  block(scene, -5, -12 + Math.max(0, legSwing), 4, 12, 1, deep)
  block(scene, 1, -12 + Math.max(0, -legSwing), 4, 12, 1, deep)
  block(scene, -8, -28, 16, 16, 3, middle)
  const working = person.activity !== 'idle' && person.activity !== 'waiting'
  const reach = working && !still ? Math.sin(time * 16) * 1.5 : 0
  block(scene, -11, -26 + reach, 3, 11, 1.5, deep)
  block(scene, 8, -26 - reach, 3, 11, 1.5, deep)
  block(scene, -7, -41, 14, 12, 3, light)
  pen.strokeStyle = deep; pen.lineWidth = 1
  pen.beginPath(); pen.moveTo(0, -41); pen.lineTo(0, -46); pen.stroke()
  const antennaColor = person.activity === 'waiting' ? colors.warning : working ? '#3fb950' : colors.muted
  disc(scene, 0, -47, 1.8, 1.8, still || !working || Math.sin(time * 6) > 0 ? antennaColor : deep)
  if (facing === 'front') {
    block(scene, -5, -38, 10, 5, 2, '#1b1d21')
    disc(scene, -2.2, -35.5, 1.1, 1.1, colors.accent)
    disc(scene, 2.2, -35.5, 1.1, 1.1, colors.accent)
  } else {
    block(scene, -4, -24, 8, 6, 1, deep)
  }
}
// Tucked up in bed, seen from above: a blanket in the shirt's colour over
// the body and the head on the pillow, eyes closed. Drawn on the floor grid
// rather than as an upright figure, so it lies along the bed.
function drawSleeper(scene, person) {
  const pen = scene.pen
  const { gx, gy } = person
  const blanket = mix(person.shirt, scene.colors.napWall, 0.2)
  const rise = isReduced(scene) ? 0 : (Math.sin((scene.clockSeconds + person.phase) * 1.3) + 1) * 0.35
  pen.save()
  pen.globalAlpha = person.alpha
  prism(scene, gx - 0.31, gy - 0.32, 0.62, 0.82, 3 + rise, 10, [mix(blanket, '#ffffff', 0.08), shade(blanket, 0.14), shade(blanket, 0.24)])
  const head = toScreen(gx, gy - 0.47, 14.5)
  disc(scene, head.x, head.y, 5.6, 5.2, person.skin)
  pen.beginPath(); pen.ellipse(head.x, head.y - 1.2, 5.9, 4.6, 0, Math.PI, Math.PI * 2); pen.fillStyle = person.hair; pen.fill()
  pen.strokeStyle = '#1b1b1b'; pen.lineWidth = 0.7
  pen.beginPath(); pen.arc(head.x - 2, head.y + 0.8, 1, 0.25, Math.PI - 0.25); pen.stroke()
  pen.beginPath(); pen.arc(head.x + 2, head.y + 0.8, 1, 0.25, Math.PI - 0.25); pen.stroke()
  if (person.key === scene.hoveredKey) {
    pen.strokeStyle = scene.colors.accent; pen.lineWidth = 1.6
    pen.beginPath(); pen.ellipse(head.x, head.y + 8, 15, 8, 0, 0, Math.PI * 2); pen.stroke()
  }
  pen.restore()
  const headTop = head.y - 8
  scene.hitBoxes.push({ key: person.key, x: head.x - 14, y: headTop, width: 28, height: 26 })
  person.headX = head.x
  person.headY = headTop
}
export function drawPerson(scene, person) {
  const pen = scene.pen
  const base = toScreen(person.gx, person.gy, person.elevation || 0)
  const walking = person.path.length > 0
  if (!walking && person.target.pose === 'bed' && person.kind !== 'robot') { drawSleeper(scene, person); return }
  let facing = person.target.facing
  let mirror = person.target.pose === 'pong' && person.target.side === 1
  if (walking) {
    const next = person.path[0]
    const screenX = (next.gx - person.gx) - (next.gy - person.gy)
    const screenY = (next.gx - person.gx) + (next.gy - person.gy)
    facing = screenY < -0.01 ? 'back' : 'front'
    mirror = screenX < 0
  }
  const pose = walking ? 'walk' : person.target.pose
  pen.save()
  pen.globalAlpha = person.alpha
  pen.translate(base.x, base.y)
  if (person.key === scene.hoveredKey) {
    pen.strokeStyle = scene.colors.accent; pen.lineWidth = 1.6
    pen.beginPath(); pen.ellipse(0, 0, 13 * person.size, 5.5 * person.size, 0, 0, Math.PI * 2); pen.stroke()
  }
  pen.scale(person.size * (mirror ? -1 : 1), person.size)
  if (person.kind === 'robot') drawRobot(scene, person, facing, pose)
  else drawHuman(scene, person, facing, pose, mirror)
  pen.restore()
  const headTop = base.y - (pose === 'walk' || pose === 'stand' || pose === 'pong' || pose === 'snooker' ? 50 : pose === 'beanbag' ? 43 : 47) * person.size
  scene.hitBoxes.push({ key: person.key, x: base.x - 12 * person.size, y: headTop, width: 24 * person.size, height: base.y - headTop + 4 })
  person.headX = base.x
  person.headY = headTop
}
