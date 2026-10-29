// Desks and what is on them: the monitor showing what its session is doing,
// the paper pile that grows with its context, the lamp, the branch pennant,
// background shells humming beside it, the chair, and the server racks.

import { shade } from './colors.js'
import { hashOf, toScreen } from './helpers.js'
import { block, disc, glow, onFrontFace, polygon, prism } from './primitives.js'
import { isReduced } from './scene.js'

const SCREEN = {
  off: '#1b1d21', code: '#1e2430', terminal: '#0d1117', read: '#f4f4f1', think: '#1e2430', waiting: '#3a2a0a', supervise: '#18202c',
}
function drawScreen(scene, mode, seed, contextPercent) {
  // Painted in the unit square of the monitor's face, v pointing up.
  const pen = scene.pen
  const colors = scene.colors
  pen.fillStyle = SCREEN[mode] || SCREEN.off
  pen.fillRect(0.05, 0.1, 0.9, 0.84)
  const time = scene.clockSeconds
  if (mode === 'code' || mode === 'terminal') {
    const palette = mode === 'code' ? ['#7fb4ff', '#c3e88d', '#f78c6c', '#d6d6d6', '#c792ea'] : ['#3fb950', '#3fb950', '#8b949e', '#3fb950']
    const scroll = isReduced(scene) ? 0 : Math.floor(time * (mode === 'terminal' ? 5 : 2.5))
    for (let line = 0; line < 7; line++) {
      const lineSeed = hashOf(seed + ':' + (line + scroll))
      const indent = mode === 'code' ? ((lineSeed >> 3) % 3) * 0.08 : 0
      const length = 0.18 + ((lineSeed >> 7) % 50) / 100
      pen.fillStyle = palette[lineSeed % palette.length]
      pen.fillRect(0.1 + indent, 0.84 - line * 0.1, Math.min(0.8 - indent, length), 0.045)
    }
    if (!isReduced(scene) && Math.floor(time * 2) % 2) { pen.fillStyle = '#e6e6e6'; pen.fillRect(0.12, 0.84 - 7 * 0.1 + 0.02, 0.05, 0.05) }
  } else if (mode === 'read') {
    for (let line = 0; line < 7; line++) {
      pen.fillStyle = '#b9b9b4'
      pen.fillRect(0.12, 0.84 - line * 0.1, 0.5 + ((hashOf(seed + line) >> 4) % 25) / 100, 0.04)
    }
    const band = isReduced(scene) ? 0.5 : 0.84 - ((time * 0.12) % 0.7)
    pen.fillStyle = 'rgba(42,120,214,.25)'
    pen.fillRect(0.08, band - 0.03, 0.84, 0.1)
  } else if (mode === 'think') {
    for (let dot = 0; dot < 3; dot++) {
      pen.fillStyle = `rgba(200,210,230,${isReduced(scene) ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(time * 4 - dot * 0.8))})`
      pen.fillRect(0.34 + dot * 0.12, 0.48, 0.07, 0.08)
    }
  } else if (mode === 'waiting') {
    pen.fillStyle = colors.warning
    pen.fillRect(0.05, 0.1, 0.9, 0.84)
    pen.save(); pen.scale(0.01, -0.01)
    pen.fillStyle = '#1b1b1b'; pen.font = '700 60px -apple-system, system-ui, sans-serif'; pen.textAlign = 'center'
    pen.fillText('?', 50, -30)
    pen.restore()
  } else if (mode === 'supervise') {
    const cells = [[0.1, 0.55], [0.52, 0.55], [0.1, 0.17], [0.52, 0.17]]
    cells.forEach(([cellLeft, cellBottom], index) => {
      pen.fillStyle = index % 2 ? '#25344a' : '#2a3d2f'
      pen.fillRect(cellLeft, cellBottom, 0.38, 0.34)
      pen.fillStyle = index % 2 ? '#7fb4ff' : '#3fb950'
      const progress = isReduced(scene) ? 0.6 : (time * 0.2 + index * 0.27) % 1
      pen.fillRect(cellLeft + 0.04, cellBottom + 0.05, 0.3 * progress, 0.04)
    })
  }
  if (mode !== 'off' && contextPercent > 0) {
    // The context meter along the bottom bezel.
    pen.fillStyle = 'rgba(255,255,255,.18)'
    pen.fillRect(0.05, 0.02, 0.9, 0.05)
    pen.fillStyle = contextPercent >= 95 ? colors.critical : contextPercent >= 80 ? colors.warning : colors.accent
    pen.fillRect(0.05, 0.02, 0.9 * Math.min(100, contextPercent) / 100, 0.05)
  }
}
function screenModeOf(owner) {
  if (!owner || owner.leaving || owner.isAway) return 'off'
  if (owner.trip && owner.activity !== 'waiting') return owner.activity === 'reading' ? 'read' : 'terminal'
  return { waiting: 'waiting', typing: 'code', reading: 'read', terminal: 'terminal', thinking: 'think', supervising: 'supervise' }[owner.activity] || 'off'
}
export function drawDesk(scene, desk, owner) {
  const pen = scene.pen
  const colors = scene.colors
  const { gx, gy } = desk
  const legs = colors.metal
  for (const [legX, legY] of [[-0.64, -0.3], [0.58, -0.3], [-0.64, 0.24], [0.58, 0.24]]) prism(scene, gx + legX, gy + legY, 0.06, 0.06, 20, 0, legs)
  prism(scene, gx + 0.2, gy - 0.28, 0.4, 0.55, 18, 0, [colors.wood[1], colors.wood[2], shade(colors.wood[2], 0.08)])
  prism(scene, gx - 0.7, gy - 0.35, 1.4, 0.7, 3, 20, colors.wood)
  const mode = screenModeOf(owner)
  const contextPercent = owner?.session?.contextPercent || 0
  const center = toScreen(gx, gy - 0.2, 38)
  if (mode !== 'off') {
    // The screen lights the desk; amber when its context is nearly full.
    const tint = contextPercent >= 80 || mode === 'waiting' ? colors.warning : colors.accent
    glow(scene, center.x, center.y, 46, tint, contextPercent >= 80 ? 0.33 : 0.22)
    scene.lights.push({ x: center.x, y: center.y + 6, radius: 48, strength: 0.7, warm: false })
  }
  // The paper pile on the left grows with the context used.
  const sheets = owner && !owner.leaving && !(owner.errand?.kind === 'shred') ? Math.round(Math.min(100, contextPercent) / 9) : 0
  for (let sheet = 0; sheet < sheets; sheet++) {
    const jitter = ((hashOf(owner.key + sheet) % 7) - 3) * 0.01
    prism(scene, gx - 0.62 + jitter, gy - 0.02 - jitter, 0.3, 0.22, 1.1, 23 + sheet * 1.1, colors.paper)
  }
  // The desk lamp at the back right, lit at night while someone is here.
  prism(scene, gx + 0.48, gy - 0.3, 0.1, 0.1, 1, 23, colors.dark)
  const lampTop = toScreen(gx + 0.53, gy - 0.25, 36)
  const lampBase = toScreen(gx + 0.53, gy - 0.25, 24)
  pen.strokeStyle = colors.dark[0]; pen.lineWidth = 1
  pen.beginPath(); pen.moveTo(lampBase.x, lampBase.y); pen.lineTo(lampTop.x + 2, lampTop.y); pen.lineTo(lampTop.x - 2, lampTop.y + 2); pen.stroke()
  const lampLit = scene.nightness > 0.35 && owner && !owner.leaving && !owner.isAway
  disc(scene, lampTop.x - 2.5, lampTop.y + 2.5, 3, 2, lampLit ? '#ffe2a6' : colors.dark[0])
  if (lampLit) {
    glow(scene, lampTop.x - 3, lampTop.y + 10, 30, '#ffc978', 0.35 * scene.nightness)
    scene.lights.push({ x: lampTop.x - 3, y: lampTop.y + 16, radius: 62, strength: 0.9, warm: true })
  }
  prism(scene, gx - 0.06, gy - 0.26, 0.12, 0.08, 6, 23, colors.dark)
  prism(scene, gx - 0.46, gy - 0.32, 0.92, 0.06, 22, 28, colors.dark)
  onFrontFace(scene, gx - 0.46, gy - 0.26, 0.92, 28, 22, () => drawScreen(scene, mode, owner?.key || String(gx + gy), contextPercent))
  // A pennant on the monitor in the colour of its branch.
  if (owner?.session?.branch && !owner.leaving) {
    const pole = toScreen(gx + 0.44, gy - 0.3, 50)
    pen.strokeStyle = colors.dark[0]; pen.lineWidth = 0.8
    pen.beginPath(); pen.moveTo(pole.x, pole.y); pen.lineTo(pole.x, pole.y - 9); pen.stroke()
    polygon(scene, [{ x: pole.x, y: pole.y - 9 }, { x: pole.x + 7, y: pole.y - 6.5 }, { x: pole.x, y: pole.y - 4 }], colors.shirts[hashOf(owner.session.branch) % colors.shirts.length])
  }
  prism(scene, gx - 0.3, gy + 0.02, 0.6, 0.17, 1.5, 23, [colors.metal[0], colors.metal[1], colors.metal[2]])
  drawShellBoxes(scene, desk, owner)
  if (!(owner?.errand?.kind === 'coffee')) {
    const mug = toScreen(gx + 0.48, gy + 0.12, 23)
    block(scene, mug.x - 2, mug.y - 5, 4, 5, 1, colors.label)
  }
}
// One small humming box per background shell, stacked on the floor at the back left of the desk.
function drawShellBoxes(scene, desk, owner) {
  const pen = scene.pen
  const shells = owner && !owner.leaving ? owner.session?.shells || [] : []
  shells.slice(0, 3).forEach((shell, index) => {
    const gx = desk.gx - 1.0, gy = desk.gy - 0.42, elevation = index * 9
    prism(scene, gx, gy, 0.3, 0.28, 8.5, elevation, scene.colors.dark)
    onFrontFace(scene, gx, gy + 0.28, 0.3, elevation, 8.5, () => {
      const seed = hashOf(shell.id)
      const isOn = isReduced(scene) || Math.sin(scene.clockSeconds * (4 + (seed % 4)) + seed) > -0.3
      pen.fillStyle = isOn ? '#3fb950' : 'rgba(63,185,80,.25)'
      pen.fillRect(0.12, 0.55, 0.14, 0.22)
      pen.fillStyle = 'rgba(63,185,80,.55)'
      const scroll = isReduced(scene) ? 0 : Math.floor(scene.clockSeconds * 3)
      for (let line = 0; line < 2; line++) pen.fillRect(0.38, 0.62 - line * 0.28, 0.2 + ((hashOf(seed + ':' + (line + scroll)) >> 3) % 30) / 100, 0.1)
    })
    const point = toScreen(gx + 0.15, gy + 0.28, elevation + 5)
    scene.lights.push({ x: point.x, y: point.y, radius: 16, strength: 0.5, warm: false })
  })
  if (shells.length > 3) {
    const point = toScreen(desk.gx - 0.85, desk.gy - 0.28, 30)
    pen.fillStyle = scene.colors.muted; pen.font = '700 8px -apple-system, system-ui, sans-serif'; pen.textAlign = 'center'
    pen.fillText(`+${shells.length - 3}`, point.x, point.y)
  }
}
export function drawChair(scene, desk, part) {
  const colors = scene.colors
  const seatX = desk.gx - 0.22, seatY = desk.gy + 0.66
  if (part === 'seat') {
    prism(scene, desk.gx - 0.03, seatY + 0.18, 0.06, 0.06, 10, 0, colors.dark)
    prism(scene, seatX, seatY, 0.44, 0.44, 3, 10, colors.dark)
  } else {
    prism(scene, seatX, seatY + 0.4, 0.44, 0.06, 10, 13, colors.dark)
  }
}
export function drawRack(scene, rack, robot) {
  const pen = scene.pen
  prism(scene, rack.gx - 0.4, rack.gy - 0.3, 0.8, 0.6, 62, 0, scene.colors.dark)
  const status = robot && !robot.leaving ? robot.activity : 'off'
  onFrontFace(scene, rack.gx - 0.4, rack.gy + 0.3, 0.8, 0, 62, () => {
    for (let row = 0; row < 9; row++) {
      pen.fillStyle = 'rgba(255,255,255,.06)'
      pen.fillRect(0.08, 0.9 - row * 0.095, 0.84, 0.07)
      for (let led = 0; led < 3; led++) {
        const seed = hashOf(rack.gx + ':' + rack.gy + ':' + row + ':' + led)
        const blinking = status !== 'off' && status !== 'idle' && !isReduced(scene)
        const isOn = blinking ? Math.sin(scene.clockSeconds * (3 + (seed % 5)) + seed) > -0.2 : seed % 3 === 0
        pen.fillStyle = isOn ? (status === 'waiting' ? scene.colors.warning : '#3fb950') : 'rgba(255,255,255,.12)'
        pen.fillRect(0.62 + led * 0.1, 0.915 - row * 0.095, 0.06, 0.035)
      }
    }
  })
  const front = toScreen(rack.gx, rack.gy + 0.3, 30)
  scene.lights.push({ x: front.x, y: front.y, radius: 26, strength: 0.4, warm: false })
}
