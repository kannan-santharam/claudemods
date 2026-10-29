// What is drawn over the room: lines between a hovered person and their
// family, project signs, the "!", thinking and chat bubbles, the "z z" over
// nappers, and name labels stepped apart so none covers another.

import { toScreen, truncate } from './helpers.js'
import { block, disc, polygon } from './primitives.js'
import { isReduced } from './scene.js'

export function drawOverlays(scene) {
  const pen = scene.pen
  const colors = scene.colors
  const hovered = scene.people.get(scene.hoveredKey)
  if (hovered) {
    // Who belongs to whom: lines from a session to its helpers, its child sessions and its parent.
    const family = [...scene.people.values()].filter(person => person !== hovered && !person.leaving && (
      person.parentKey === hovered.key || hovered.parentKey === person.key || (hovered.parentKey && person.parentKey === hovered.parentKey && person.kind !== 'helper')))
    pen.save()
    pen.setLineDash([4, 3]); pen.strokeStyle = colors.accent; pen.lineWidth = 1.4
    for (const relative of family) {
      if (relative.headX == null) continue
      pen.beginPath(); pen.moveTo(hovered.headX, hovered.headY + 20 * hovered.size); pen.lineTo(relative.headX, relative.headY + 20 * relative.size); pen.stroke()
    }
    pen.restore()
  }
  pen.textAlign = 'center'
  const placed = []
  const overlaps = box => placed.some(other => box.x < other.x + other.width && box.x + box.width > other.x && box.y < other.y + other.height && box.y + box.height > other.y)
  // Project signs at the front corner of each rug.
  if (scene.showNames) {
    pen.font = '700 10px -apple-system, system-ui, sans-serif'
    for (const segment of scene.layout.segments) {
      if (!segment.isFirst) continue
      const anchor = toScreen(segment.x0 - 0.85, segment.gy + 1.4)
      const text = truncate(segment.label, 22) + (segment.count > 1 ? ` · ${segment.count}` : '')
      const width = pen.measureText(text).width + 22
      const box = { x: anchor.x - 4, y: anchor.y + 2, width, height: 16 }
      placed.push(box)
      block(scene, box.x, box.y, width, 16, 4, colors.label)
      pen.strokeStyle = segment.color; pen.lineWidth = 1.2
      pen.beginPath(); pen.roundRect(box.x, box.y, width, 16, 4); pen.stroke()
      disc(scene, box.x + 9, box.y + 8, 3.5, 3.5, segment.color)
      pen.fillStyle = colors.text; pen.textAlign = 'left'
      pen.fillText(text, box.x + 16, box.y + 11.5)
      pen.textAlign = 'center'
    }
  }
  const ordered = [...scene.people.values()].filter(person => person.headX != null && person.alpha >= 0.3)
    .sort((first, second) => rank(first) - rank(second))
  function rank(person) { return person.key === scene.hoveredKey ? 0 : person.activity === 'waiting' ? 1 : person.kind === 'helper' ? 3 : 2 }
  for (const person of ordered) {
    const pulse = isReduced(scene) ? 1 : 1 + Math.sin(scene.clockSeconds * (person.isUrgent ? 9 : 5) + person.phase) * (person.isUrgent ? 0.16 : 0.08)
    let labelY = person.headY - 4
    if (person.activity === 'waiting' && !person.leaving) {
      const bubbleY = person.headY - 11
      disc(scene, person.headX, bubbleY, 8 * pulse, 8 * pulse, colors.critical)
      polygon(scene, [{ x: person.headX - 3, y: bubbleY + 6 }, { x: person.headX + 3, y: bubbleY + 6 }, { x: person.headX, y: bubbleY + 11 }], colors.critical)
      pen.fillStyle = '#ffffff'; pen.font = '800 11px -apple-system, system-ui, sans-serif'
      pen.fillText('!', person.headX, bubbleY + 4)
      labelY = bubbleY - 11
      placed.push({ x: person.headX - 9, y: bubbleY - 9, width: 18, height: 20 })
    } else if (person.activity === 'thinking' && person.kind !== 'helper' && !person.path.length) {
      const bubbleY = person.headY - 8
      block(scene, person.headX + 2, bubbleY - 6, 16, 9, 4.5, colors.label)
      pen.fillStyle = colors.muted; pen.font = '700 9px -apple-system, system-ui, sans-serif'
      pen.fillText('…', person.headX + 10, bubbleY + 1)
    } else if (person.activity === 'idle' && (person.target?.pose === 'bed' || person.target?.pose === 'beanbag') && !person.path.length) {
      // Asleep in the nap room: letters drifting up and fading, or still ones without motion.
      pen.fillStyle = colors.text
      if (isReduced(scene)) {
        pen.font = '700 9px -apple-system, system-ui, sans-serif'
        pen.fillText('z z', person.headX + 10, person.headY - 2)
      } else {
        for (let letter = 0; letter < 3; letter++) {
          const drift = (scene.clockSeconds * 0.45 + letter / 3 + person.phase) % 1
          pen.globalAlpha = person.alpha * 0.85 * (drift < 0.15 ? drift / 0.15 : 1 - (drift - 0.15) / 0.85)
          pen.font = `700 ${8 + drift * 4}px -apple-system, system-ui, sans-serif`
          pen.fillText('z', person.headX + 6 + drift * 8, person.headY + 2 - drift * 16)
        }
        pen.globalAlpha = 1
      }
      // Keep the name clear of the letters.
      placed.push({ x: person.headX + 4, y: person.headY - 16, width: 20, height: 18 })
      labelY = person.headY - 17
    } else if (person.activity === 'idle' && person.target?.pose !== 'sofa' && !person.path.length && !person.errand && !isReduced(scene)) {
      // Chat in the lounge: neighbours take turns.
      const neighbour = ordered.some(other => other !== person && other.activity === 'idle' && Math.hypot(other.gx - person.gx, other.gy - person.gy) < 1.7)
      if (neighbour && Math.floor((scene.clockSeconds + person.phase * 3) / 2.5) % 3 === 0) {
        const bubbleY = person.headY - 9
        block(scene, person.headX + 3, bubbleY - 7, 18, 10, 5, colors.label)
        polygon(scene, [{ x: person.headX + 5, y: bubbleY + 2 }, { x: person.headX + 9, y: bubbleY + 2 }, { x: person.headX + 4, y: bubbleY + 6 }], colors.label)
        pen.fillStyle = colors.muted; pen.font = '700 9px -apple-system, system-ui, sans-serif'
        pen.fillText('···', person.headX + 12, bubbleY + 0.5)
      }
    }
    // With Names off nothing is named but the one under the pointer, so snapshots stay private.
    const wantsName = person.key === scene.hoveredKey || (scene.showNames && (person.activity === 'waiting' || person.kind !== 'helper'))
    if (!wantsName || !person.label) continue
    pen.font = '600 10px -apple-system, system-ui, sans-serif'
    const text = truncate(person.label, person.key === scene.hoveredKey ? 48 : 18)
    const width = pen.measureText(text).width + 10
    // Step the label up or down until it no longer covers another one.
    let box = null
    for (const shift of [0, -15, 15, -30, 30]) {
      const candidate = { x: person.headX - width / 2, y: labelY - 13 + shift, width, height: 14 }
      if (!overlaps(candidate)) { box = candidate; break }
    }
    if (!box) {
      if (rank(person) > 1) continue
      box = { x: person.headX - width / 2, y: labelY - 13, width, height: 14 }
    }
    placed.push(box)
    pen.globalAlpha = person.alpha * (person.key === scene.hoveredKey ? 1 : 0.92)
    if (Math.abs(box.y - (labelY - 13)) > 1) {
      pen.strokeStyle = colors.border; pen.lineWidth = 0.8
      pen.beginPath(); pen.moveTo(person.headX, person.headY - 2); pen.lineTo(person.headX, box.y + (box.y < labelY - 13 ? 14 : 0)); pen.stroke()
    }
    block(scene, box.x, box.y, width, 14, 7, colors.label)
    pen.strokeStyle = person.activity === 'waiting' ? colors.critical : colors.border
    pen.lineWidth = 0.8
    pen.beginPath(); pen.roundRect(box.x, box.y, width, 14, 7); pen.stroke()
    pen.fillStyle = colors.text
    pen.fillText(text, person.headX, box.y + 10.5)
    pen.globalAlpha = 1
  }
}
