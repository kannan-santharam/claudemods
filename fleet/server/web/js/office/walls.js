// What hangs on the walls: windows onto a skyline that follows the time of
// day, the clock, the plan usage board, the whiteboard, a framed poster and
// the nap room's sign.

import { resetsIn } from '../tiles.js'
import { mix } from './colors.js'
import { LOUNGE_WIDTH, SLANT } from './constants.js'
import { hashOf } from './helpers.js'
import { block, disc, onBackWall, onLeftWall, polygon } from './primitives.js'
import { isReduced } from './scene.js'

// Windows look out on a city that follows the time of day; drawn every
// frame because the clouds drift.
function skyColors(scene) {
  const day = ['#8fc4f2', '#dcecfa'], night = ['#0a1430', '#1d2a4c'], dusk = ['#5d5a8f', '#f0a477']
  const middle = 1 - Math.abs(scene.nightness - 0.5) * 2
  const top = scene.nightness < 0.5 ? mix(day[0], dusk[0], scene.nightness * 2) : mix(dusk[0], night[0], (scene.nightness - 0.5) * 2)
  const bottom = scene.nightness < 0.5 ? mix(day[1], dusk[1], scene.nightness * 2) : mix(dusk[1], night[1], (scene.nightness - 0.5) * 2)
  return { top, bottom, middle }
}
function paintView(scene, width, height, startAt, seed) {
  // Painted in pixels, y down, width x height; startAt places the window in the shared skyline.
  const pen = scene.pen
  const sky = skyColors(scene)
  const gradient = pen.createLinearGradient(0, 0, 0, height)
  gradient.addColorStop(0, sky.top)
  gradient.addColorStop(1, sky.bottom)
  pen.fillStyle = gradient
  pen.fillRect(0, 0, width, height)
  if (scene.nightness > 0.6) {
    for (let star = 0; star < 6; star++) {
      const starSeed = hashOf(seed + ':star' + star)
      const twinkle = isReduced(scene) ? 0.7 : 0.45 + 0.45 * Math.sin(scene.clockSeconds * 2 + star)
      pen.fillStyle = `rgba(255,255,255,${twinkle * (scene.nightness - 0.5) * 2})`
      pen.fillRect((starSeed % 1000) / 1000 * width, ((starSeed >> 10) % 1000) / 1000 * height * 0.45, 0.9, 0.9)
    }
  }
  if (seed === 'sun') {
    const isSun = scene.nightness < 0.5
    disc(scene, width * 0.72, height * 0.3, 4.5, 4.5, isSun ? 'rgba(255,236,160,.95)' : 'rgba(240,240,225,.9)')
    if (!isSun) disc(scene, width * 0.72 + 1.8, height * 0.3 - 1.2, 3.8, 3.8, sky.top)
  }
  if (scene.nightness < 0.8) {
    for (let cloud = 0; cloud < 2; cloud++) {
      const cloudSeed = hashOf(seed + ':cloud' + cloud)
      const travel = isReduced(scene) ? 0 : scene.clockSeconds * (2 + (cloudSeed % 3))
      const x = ((startAt * 0.4 + (cloudSeed % 300) + travel) % (width + 60)) - 30
      const y = 5 + ((cloudSeed >> 8) % 12)
      pen.fillStyle = `rgba(255,255,255,${0.75 * (1 - scene.nightness)})`
      disc(scene, x, y, 9, 3.2, pen.fillStyle); disc(scene, x + 6, y - 2, 6, 3, pen.fillStyle)
    }
  }
  // The skyline: buildings at fixed places along the whole wall, so every window shows the same city.
  const buildingColor = scene.nightness > 0.5 ? mix('#26314f', '#121a33', (scene.nightness - 0.5) * 2) : mix('#9fb3c8', '#6d7e99', scene.nightness * 2)
  for (let index = Math.floor(startAt / 9) - 1; index * 9 < startAt + width + 9; index++) {
    const buildingSeed = hashOf('building' + index)
    const x = index * 9 - startAt
    const tall = height * (0.28 + ((buildingSeed % 100) / 100) * 0.42)
    const wide = 7 + (buildingSeed >> 7) % 5
    pen.fillStyle = buildingColor
    pen.fillRect(x, height - tall, wide, tall)
    if (scene.nightness > 0.4) {
      for (let litRow = 0; litRow * 4 < tall - 4; litRow++) {
        for (let litColumn = 0; litColumn < 2; litColumn++) {
          const windowSeed = hashOf(buildingSeed + ':' + litRow + ':' + litColumn)
          if (windowSeed % 3) continue
          pen.fillStyle = `rgba(255,214,140,${0.85 * scene.nightness})`
          pen.fillRect(x + 1.5 + litColumn * 3, height - tall + 2 + litRow * 4, 1.3, 1.6)
        }
      }
    }
  }
}
export function drawWindows(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const height = 38
  scene.layout.backWindows.forEach(([from, to], index) => {
    const width = (to - from) * SLANT
    onBackWall(scene, from, 72, () => {
      pen.save()
      pen.beginPath(); pen.rect(0, 0, width, height); pen.clip()
      paintView(scene, width, height, from * SLANT, index === 1 ? 'sun' : 'back' + index)
      pen.restore()
      pen.strokeStyle = colors.border; pen.lineWidth = 1.4
      pen.strokeRect(0, 0, width, height)
      pen.fillStyle = colors.border
      pen.fillRect(width / 2 - 0.7, 0, 1.4, height)
      pen.fillStyle = mix(colors.wallBack, colors.text, 0.15)
      pen.fillRect(-2, height, width + 4, 2.4)
    })
  })
  scene.layout.leftWindows.forEach(([from, to], index) => {
    const width = (to - from) * SLANT
    onLeftWall(scene, to, 72, () => {
      pen.save()
      pen.beginPath(); pen.rect(0, 0, width, height); pen.clip()
      paintView(scene, width, height, 400 + index * 80, 'left' + index)
      pen.restore()
      pen.strokeStyle = colors.border; pen.lineWidth = 1.4
      pen.strokeRect(0, 0, width, height)
      pen.fillStyle = colors.border
      pen.fillRect(width / 2 - 0.7, 0, 1.4, height)
    })
  })
}
export function drawClock(scene) {
  // A wall clock showing the real time, between the lounge and the desks.
  const pen = scene.pen
  const colors = scene.colors
  onBackWall(scene, LOUNGE_WIDTH + 0.55, 76, () => {
    disc(scene, 0, 0, 10.5, 10.5, colors.dark[1])
    disc(scene, 0, 0, 9, 9, colors.label)
    pen.strokeStyle = colors.muted; pen.lineWidth = 0.8
    for (let mark = 0; mark < 12; mark++) {
      const angle = (mark / 12) * Math.PI * 2
      pen.beginPath(); pen.moveTo(Math.sin(angle) * 7, -Math.cos(angle) * 7); pen.lineTo(Math.sin(angle) * 8.2, -Math.cos(angle) * 8.2); pen.stroke()
    }
    const date = new Date()
    const minutes = date.getMinutes() + date.getSeconds() / 60
    const hours = (date.getHours() % 12) + minutes / 60
    const hand = (angle, length, width, color) => { pen.strokeStyle = color; pen.lineWidth = width; pen.lineCap = 'round'; pen.beginPath(); pen.moveTo(0, 0); pen.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length); pen.stroke(); pen.lineCap = 'butt' }
    hand((hours / 12) * Math.PI * 2, 4.6, 1.6, colors.text)
    hand((minutes / 60) * Math.PI * 2, 6.8, 1.1, colors.text)
    if (!isReduced(scene)) hand((date.getSeconds() / 60) * Math.PI * 2, 7.4, 0.5, colors.critical)
    disc(scene, 0, 0, 1, 1, colors.text)
  }, 0.02)
}
export function drawPlanBoard(scene) {
  // A board on the back wall above the sofa with the plan's usage windows.
  const pen = scene.pen
  const colors = scene.colors
  const from = 0.9, to = 4.5
  const width = (to - from) * SLANT
  onBackWall(scene, from, 80, () => {
    block(scene, 0, 0, width, 52, 2, colors.label)
    pen.strokeStyle = colors.border; pen.lineWidth = 1; pen.strokeRect(0, 0, width, 52)
    pen.fillStyle = colors.text
    pen.font = '700 11px -apple-system, system-ui, sans-serif'
    pen.textAlign = 'left'
    pen.fillText('Plan usage', 8, 15)
    pen.font = '9.5px -apple-system, system-ui, sans-serif'
    if (!scene.planLimits.length) {
      pen.fillStyle = colors.muted
      pen.fillText('shows once a session reports in', 8, 32)
    }
    scene.planLimits.slice(0, 2).forEach((limit, index) => {
      const rowTop = 20 + index * 16
      const percent = Math.min(100, Math.round(limit.percentUsed))
      const name = { five_hour: '5-hour', seven_day: '7-day', seven_day_opus: '7-day Opus' }[limit.kind] || String(limit.kind).replace(/_/g, ' ')
      pen.fillStyle = colors.muted
      const resets = limit.resetsAt ? resetsIn(limit.resetsAt).split(' · ')[0].replace(/^resets /i, '') : ''
      pen.fillText(`${name} ${percent}%${resets ? ' · ' + resets : ''}`, 8, rowTop + 7)
      block(scene, 8, rowTop + 10, width - 16, 3.5, 1.5, colors.border)
      block(scene, 8, rowTop + 10, Math.max(2, (width - 16) * percent / 100), 3.5, 1.5, percent >= 90 ? colors.critical : percent >= 80 ? colors.warning : colors.accent)
    })
  })
}
export function drawWhiteboard(scene) {
  // What the sessions in the office have done, on the left wall.
  const pen = scene.pen
  const colors = scene.colors
  const from = 1.3, to = 3.6
  const width = (to - from) * SLANT
  onLeftWall(scene, to, 76, () => {
    block(scene, -2, -2, width + 4, 50, 2, colors.metal[1])
    block(scene, 0, 0, width, 46, 1.5, colors.isDark ? '#e9ebee' : '#ffffff')
    pen.textAlign = 'left'
    pen.fillStyle = '#2a2d33'
    pen.font = '700 10.5px -apple-system, system-ui, sans-serif'
    pen.fillText('Live sessions', 7, 13)
    pen.font = '9px -apple-system, system-ui, sans-serif'
    pen.fillStyle = '#3d4250'
    pen.fillText(`${scene.today.commits} commit${scene.today.commits === 1 ? '' : 's'} · ${scene.today.pushes} push${scene.today.pushes === 1 ? '' : 'es'}`, 7, 26)
    pen.fillText(`${scene.today.prompts} prompt${scene.today.prompts === 1 ? '' : 's'} · ${scene.today.working} working now`, 7, 38)
    block(scene, width - 26, 40, 8, 2.5, 1, colors.critical)
    block(scene, width - 16, 40, 8, 2.5, 1, colors.accent)
  })
}
export function drawPoster(scene) {
  // Framed art above the bookshelf.
  const colors = scene.colors
  const from = scene.layout.utilityX + 0.35, to = scene.layout.utilityX + 1.45
  const width = (to - from) * SLANT
  onBackWall(scene, from, 80, () => {
    block(scene, 0, 0, width, 26, 1.5, colors.dark[1])
    block(scene, 2, 2, width - 4, 22, 1, colors.isDark ? '#e7e2d6' : '#f6f1e6')
    disc(scene, width * 0.35, 13, 6, 6, colors.shirts[3])
    block(scene, width * 0.5, 7, 9, 12, 1, colors.shirts[0])
    polygon(scene, [{ x: width * 0.62, y: 20 }, { x: width * 0.86, y: 20 }, { x: width * 0.74, y: 6 }], colors.shirts[2])
  })
}
export function drawNapSign(scene) {
  // A small sign with a moon above the beds, so the dim corner reads as the nap room.
  const pen = scene.pen
  const colors = scene.colors
  const room = scene.layout.napRoom
  const from = room.x0 + 0.25, to = room.x1 - 0.25
  const width = (to - from) * SLANT
  onBackWall(scene, from, 74, () => {
    block(scene, 0, 0, width, 15, 3, colors.isDark ? '#1c2038' : '#3a4066')
    disc(scene, 11, 7.5, 4, 4, '#f3d98b')
    disc(scene, 12.8, 6.2, 3.4, 3.4, colors.isDark ? '#1c2038' : '#3a4066')
    pen.fillStyle = '#e8e6f4'
    pen.font = '700 8.5px -apple-system, system-ui, sans-serif'
    pen.textAlign = 'left'
    pen.fillText('Nap room', 20, 10.5)
  })
}
