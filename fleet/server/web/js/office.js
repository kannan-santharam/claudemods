import { $, css, toast } from './core/dom.js'
import { ago, shortModel } from './core/format.js'
import { sessionById, state } from './core/state.js'
import { remember, remembered } from './core/storage.js'
import { focusTab } from './sessions/actions.js'
import { isListView } from './sessions/list-view.js'
import { renderLive } from './sessions/live.js'
import { STATUS, sessionTree } from './sessions/tree.js'
import { setTab } from './tabs.js'
import { resetsIn } from './tiles.js'
import { tip } from './tooltip.js'

// ----------------------------------------------------------------- office --
// The Office tab: every session as a person in an isometric office, drawn on a
// canvas with no image assets. Sessions sit with their project: each folder is
// a row of desks on its own coloured rug. A working session sits at its desk
// and its screen shows what it is doing (code for edits, a page for reads, a
// terminal for commands), with a paper pile that grows with its context; one
// waiting for you stands up with a "!"; idle ones are in the lounge, on the
// sofa, at the ping-pong table or fetching coffee. What a session wears says
// which model it runs. Commits fly to the outbox as parcels, pushes leave by
// the window as paper planes and a compaction is a trip to the shredder.
// Running subagents are small helpers on stools beside their session, and a
// headless session started by another is a robot at the server racks. The
// room is lit by the local time of day, and the dark theme is night.
function createOffice() {
  const TILE_X = 32, TILE_Y = 16, WALL_HEIGHT = 84
  const SLANT = Math.hypot(TILE_X, TILE_Y)
  const WALK_SPEED = 3.2 // tiles per second
  const LOUNGE_WIDTH = 4.8, DESK_STEP_X = 2.4, DESK_STEP_Y = 2.9, GROUP_GAP = 0.9, UTILITY_WIDTH = 2.9
  const SKIN_TONES = ['#f2c9a8', '#e3b08b', '#c98d66', '#9e6845', '#6e4a33']
  const HAIR_COLORS = ['#2b2118', '#5a3a22', '#8a5a2b', '#caa052', '#3b3b3b', '#a33d2b', '#d9d4cc']
  const SHIRT_TOKENS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7']
  const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
  const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'NotebookRead'])
  const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
  const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'Monitor'])
  const DELEGATE_TOOLS = new Set(['Agent', 'Task', 'SendMessage'])
  const LONG_COMMAND_MS = 20_000 // a command running this long is watched from the racks
  const TRIP_MIN_MS = 8_000, TRIP_COOLDOWN_MS = 15_000
  const WAIT_ALERT_MS = 120_000
  const ACTIVITY_LABEL = {
    typing: 'editing files', reading: 'reading and searching', terminal: 'running commands', thinking: 'thinking',
    supervising: 'watching its helpers', waiting: 'needs your input', idle: 'in the lounge', relaxing: 'resting at its desk',
  }
  const TRIP_LABEL = { globe: 'searching the web at the globe', racks: 'watching a long command at the racks' }
  const OUTFIT_LABEL = { blazer: 'blazer (Opus)', hoodie: 'hoodie (Sonnet)', beanie: 'beanie (Haiku)', headphones: 'headphones (Fable)' }
  // The Office canvas; drawMini lends both to a small canvas for one frame.
  let canvas = $('#office-canvas')
  const card = $('#office-card')
  let mainPen = canvas.getContext('2d')
  const lightCanvas = document.createElement('canvas')
  const lightPen = lightCanvas.getContext('2d')
  const motionQuery = matchMedia('(prefers-reduced-motion: reduce)')
  const people = new Map() // key -> person (a session, a helper or a robot)
  const rackOf = new Map() // sessionId -> rack slot
  const loungeOf = new Map() // sessionId -> lounge spot, while idle
  const tripOf = new Map() // sessionId -> { kind, slot }
  const groupOrder = new Map() // folder -> first seen order, so projects keep their place
  const memberOrder = new Map() // sessionId -> first seen order within the office
  const previous = new Map() // sessionId -> what the last sync saw, to spot what changed
  const waitingSince = new Map() // sessionId -> when it started waiting
  const events = [] // the ticker, newest first
  let effects = [] // parcels, planes and paper in flight
  let outboxCount = 0
  let pen = mainPen
  let layout = buildLayout([], 0)
  let colors = null
  let floorCache = null
  let floorCacheKey = ''
  let view = { scale: 1, offsetX: 0, offsetY: 0, cssWidth: 0, cssHeight: 0, ratio: 1, baseCenterX: 0, baseCenterY: 0, spanX: 1, spanY: 1 }
  let camera = { zoom: 1, x: 0, y: 0 }
  let cameraGoal = { zoom: 1, x: 0, y: 0 }
  let cameraReturnAt = 0
  let isActive = false
  let frameId = 0
  let lastFrameAt = 0
  let clockSeconds = 0
  let hoveredKey = ''
  let hitBoxes = []
  let lights = []
  let hasSynced = false
  let liveIds = new Set()
  let planLimits = []
  let dimming = 0
  let nightness = 0
  let today = { commits: 0, pushes: 0, prompts: 0, working: 0 }
  let showNames = remembered('fleet-office-names') !== 'off'
  let soundOn = remembered('fleet-office-chime') === 'on'
  let audio = null
  let orderCounter = 0

  const isReduced = () => motionQuery.matches
  const hashOf = text => { let hash = 2166136261; for (const ch of String(text)) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619); return hash >>> 0 }
  const toScreen = (gx, gy, height = 0) => ({ x: (gx - gy) * TILE_X, y: (gx + gy) * TILE_Y - height })
  const firstFree = (used, from = 0) => { const taken = new Set(used.values()); let index = from; while (taken.has(index)) index++; return index }
  const truncate = (text, length) => (text.length > length ? text.slice(0, length - 1) + '…' : text)
  const isWallMode = () => document.fullscreenElement === card
  const outfitOf = model => {
    const name = String(model || '').toLowerCase()
    return name.includes('opus') ? 'blazer' : name.includes('sonnet') ? 'hoodie' : name.includes('haiku') ? 'beanie' : name.includes('fable') ? 'headphones' : ''
  }
  const folderOf = session => session.folder || session.cwd || 'other'

  // ------------------------------------------------------------- colour --
  function parseHex(hex) {
    const value = String(hex).replace('#', '')
    const full = value.length === 3 ? value.split('').map(ch => ch + ch).join('') : value
    return [0, 2, 4].map(start => parseInt(full.slice(start, start + 2), 16) || 0)
  }
  function mix(first, second, ratio) {
    const [red1, green1, blue1] = parseHex(first), [red2, green2, blue2] = parseHex(second)
    const blend = (one, two) => Math.round(one + (two - one) * ratio).toString(16).padStart(2, '0')
    return '#' + blend(red1, red2) + blend(green1, green2) + blend(blue1, blue2)
  }
  const shade = (hex, ratio) => mix(hex, '#000000', ratio)
  const alpha = (hex, opacity) => { const [red, green, blue] = parseHex(hex); return `rgba(${red},${green},${blue},${opacity})` }
  // The Office keeps its colours when the page around it goes grey: --office-* wins where set.
  const officeCss = name => css(name.replace(/^--/, '--office-')) || css(name)
  function refreshColors() {
    const background = parseHex(css('--bg') || '#f4f4f2')
    const isDark = (background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114) / 255 < 0.45
    const floor = css('--surface-2')
    const wood = isDark ? ['#7a654b', '#5f4e3a', '#4d3f2f'] : ['#e6d4b4', '#cfb68f', '#bba077']
    colors = {
      isDark,
      floorA: floor,
      floorB: mix(floor, css('--surface-3'), 0.6),
      plankA: mix(floor, wood[0], isDark ? 0.32 : 0.38),
      plankB: mix(floor, wood[1], isDark ? 0.32 : 0.34),
      plankLine: mix(floor, wood[2], isDark ? 0.5 : 0.5),
      floorEdge: [floor, shade(css('--surface-3'), 0.08), shade(css('--surface-3'), 0.16)],
      wallLeft: css('--surface-1'),
      wallBack: mix(css('--surface-1'), css('--surface-3'), 0.55),
      wallTop: css('--border'),
      border: css('--border'),
      text: css('--text-primary'),
      muted: css('--text-muted'),
      label: css('--surface-1'),
      accent: officeCss('--accent'),
      accentSoft: officeCss('--accent-soft'),
      critical: officeCss('--critical'),
      warning: officeCss('--series-4'),
      good: officeCss('--good'),
      shirts: SHIRT_TOKENS.map(name => officeCss(name)),
      wood,
      metal: isDark ? ['#4a4d52', '#3a3c40', '#2e3033'] : ['#cfd2d6', '#b3b7bd', '#9fa4ab'],
      dark: isDark ? ['#33363b', '#232528', '#1a1b1e'] : ['#43464c', '#2f3136', '#25272b'],
      sofa: isDark ? ['#4f7470', '#3e5c59', '#344d4a'] : ['#93bbb6', '#7aa59f', '#6a928c'],
      pot: isDark ? ['#8a5a40', '#6e4632', '#5b3a2a'] : ['#c9805c', '#b06a48', '#985a3c'],
      table: isDark ? ['#2f6b4f', '#24543e', '#1d4533'] : ['#3f8f69', '#337a58', '#2a684a'],
      paper: isDark ? ['#d8d6cf', '#bdbab2', '#a9a69e'] : ['#fbfaf6', '#e4e1d9', '#d2cfc6'],
      leaf: isDark ? '#3f7d4f' : '#4f9a62',
      leafDark: isDark ? '#2f6440' : '#3d7f4f',
      pants: isDark ? '#3a4150' : '#4a5468',
      shadow: isDark ? 'rgba(0,0,0,.45)' : 'rgba(20,20,18,.16)',
      robot: isDark ? ['#8b939d', '#6f7782', '#5c636d'] : ['#c3cad3', '#a6afba', '#929ba6'],
    }
  }
  // How dark it is outside: 0 by day, 1 at night. The dark theme is always night.
  function nightnessNow() {
    if (colors.isDark) return 1
    const date = new Date()
    const hour = date.getHours() + date.getMinutes() / 60
    if (hour >= 7 && hour <= 17) return 0
    if (hour > 17 && hour < 19.5) return (hour - 17) / 2.5
    if (hour >= 5.5 && hour < 7) return 1 - (hour - 5.5) / 1.5
    return 1
  }

  // ------------------------------------------------------------- layout --
  // The lounge is on the left, then the projects: each folder gets a run of
  // desks on its own rug, packed into rows, in the order the folders first
  // appeared, so a project keeps its place as others come and go. The
  // utility corner on the right holds the bookshelf, the globe, the server
  // racks, the printer with its outbox and the shredder. A corridor runs along
  // the front, with the door in the left wall.
  function buildLayout(groups, rackCount) {
    const total = groups.reduce((sum, group) => sum + group.members.length, 0)
    // Rows about as long as the room is deep, so the office stays roughly square.
    const perRow = Math.max(3, Math.min(8, Math.ceil(Math.sqrt(total * 1.3))))
    const deskStartX = LOUNGE_WIDTH + 1.4
    const deskBySession = new Map()
    const segments = []
    let row = 0, column = 0, gaps = 0, widest = 0
    for (const group of groups) {
      const size = group.members.length
      if (column > 0 && column + Math.min(size, perRow) > perRow) { row++; column = 0; gaps = 0 }
      if (column > 0) gaps++
      let segment = null
      group.members.forEach((sessionId, index) => {
        if (column === perRow) { row++; column = 0; gaps = 0; segment = null }
        const gx = deskStartX + column * DESK_STEP_X + gaps * GROUP_GAP
        const gy = 1.6 + row * DESK_STEP_Y
        deskBySession.set(sessionId, { gx, gy, group: group.key })
        if (!segment) { segment = { key: group.key, label: group.label, color: group.color, x0: gx, x1: gx, gy, isFirst: index === 0, count: size }; segments.push(segment) }
        segment.x1 = gx
        widest = Math.max(widest, gx - deskStartX + 1)
        column++
      })
    }
    const rows = segments.length ? row + 1 : 0
    const utilityX = deskStartX + Math.max(widest, 1.2) + 0.9
    const rackRows = Math.max(1, Math.ceil(Math.max(rackCount, 2) / 2))
    const racks = []
    for (let slot = 0; slot < rackRows * 2; slot++) racks.push({ gx: utilityX + 0.6 + (slot % 2) * 1.5, gy: 2.15 + Math.floor(slot / 2) * 2.4 })
    const rackBottom = 2.15 + (rackRows - 1) * 2.4 + 1.4
    const floorDepth = Math.ceil(Math.max(8.4, 1.6 + rows * DESK_STEP_Y + 0.6, rackBottom + 3.2))
    const floorWidth = Math.ceil(utilityX + UTILITY_WIDTH)
    const corridorY = floorDepth - 0.65
    const lounge = []
    for (const gx of [1.75, 2.55, 3.35]) lounge.push({ gx, gy: 2.05, pose: 'sofa', facing: 'front' })
    lounge.push({ gx: 1.1, gy: 3.9, pose: 'pong', facing: 'front', side: 0 }, { gx: 3.95, gy: 3.9, pose: 'pong', facing: 'front', side: 1 })
    // Standing spots fill every other row first, staggered, so a crowd spreads over the rug.
    const standing = []
    for (let line = 0, gy = 5.1; gy <= corridorY - 0.9; line++, gy += 1.05) {
      for (const gx of line % 2 ? [1.9, 3.3] : [1.2, 2.6, 4.0]) standing.push({ gx, gy, pose: 'stand', facing: 'front', line })
    }
    standing.sort((first, second) => (first.line % 2) - (second.line % 2) || first.line - second.line)
    lounge.push(...standing)
    const backWindows = []
    for (let gx = deskStartX - 0.4; gx + 1.6 < utilityX - 0.3; gx += 2.4) backWindows.push([gx, gx + 1.6])
    const leftWindows = []
    for (let gy = 5.0; gy + 1.8 < corridorY - 0.9; gy += 2.6) leftWindows.push([gy, gy + 1.8])
    const printer = { gx: utilityX + 0.25, gy: rackBottom + 0.1 }
    const shredder = { gx: utilityX + 1.6, gy: rackBottom + 0.25 }
    return {
      rows, perRow, deskBySession, segments, racks, lounge, floorWidth, floorDepth, corridorY, deskStartX, utilityX,
      rackDepth: rackBottom, backWindows, leftWindows, printer, shredder,
      bookshelf: { gx: utilityX + 0.1, gy: 0.06 },
      globe: { gx: utilityX + 2.3, gy: 0.75 },
      globeSpots: [{ gx: utilityX + 1.95, gy: 1.4 }, { gx: utilityX + 2.65, gy: 1.45 }, { gx: utilityX + 2.3, gy: 1.75 }],
      watchSpots: racks.filter((rack, slot) => slot % 2 === 0).flatMap(rack => [{ gx: utilityX + 1.1, gy: rack.gy + 1.05 }, { gx: utilityX + 1.7, gy: rack.gy + 1.1 }]),
      shelfSpots: [{ gx: utilityX + 0.55, gy: 0.95 }, { gx: utilityX + 1.2, gy: 0.95 }],
      coffeeSpots: [{ gx: 0.62, gy: 1.2 }, { gx: 0.62, gy: 1.75 }],
      shredSpots: [{ gx: shredder.gx + 0.3, gy: shredder.gy + 0.95 }, { gx: shredder.gx - 0.35, gy: shredder.gy + 1.05 }],
      door: { gx: 0.4, gy: corridorY },
      outside: { gx: -0.9, gy: corridorY },
      key: [floorWidth, floorDepth, rackRows, ...segments.map(segment => `${segment.key}:${segment.x0}:${segment.x1}:${segment.gy}`)].join('|'),
    }
  }
  function worldBounds() {
    const { floorWidth, floorDepth } = layout
    return { minX: -floorDepth * TILE_X - 24, maxX: floorWidth * TILE_X + 24, minY: -WALL_HEIGHT - 30, maxY: (floorWidth + floorDepth) * TILE_Y + 26 }
  }
  function fitView() {
    const holder = canvas.parentElement
    const cssWidth = Math.floor(holder.clientWidth)
    if (!cssWidth) return false
    const { minX, maxX, minY, maxY } = worldBounds()
    const spanX = maxX - minX, spanY = maxY - minY
    let baseScale, cssHeight
    if (isWallMode()) {
      cssHeight = Math.max(200, Math.floor(holder.clientHeight))
      baseScale = Math.min(cssWidth / spanX, cssHeight / spanY)
    } else {
      baseScale = Math.max(0.35, Math.min(1.5, cssWidth / spanX, 640 / spanY))
      cssHeight = Math.round(spanY * baseScale)
    }
    const scale = baseScale * camera.zoom
    const baseCenterX = (minX + maxX) / 2, baseCenterY = (minY + maxY) / 2
    const centerX = baseCenterX + camera.x, centerY = baseCenterY + camera.y
    const ratio = window.devicePixelRatio || 1
    view = { scale, baseScale, ratio, cssWidth, cssHeight, spanX, spanY, baseCenterX, baseCenterY, offsetX: cssWidth / 2 - centerX * scale, offsetY: cssHeight / 2 - centerY * scale }
    if (canvas.width !== Math.round(cssWidth * ratio) || canvas.height !== Math.round(cssHeight * ratio)) {
      canvas.width = Math.round(cssWidth * ratio)
      canvas.height = Math.round(cssHeight * ratio)
      canvas.style.height = cssHeight + 'px'
    }
    return true
  }
  const worldTransform = (target, factor = 1) => target.setTransform(view.ratio * view.scale * factor, 0, 0, view.ratio * view.scale * factor, view.ratio * view.offsetX * factor, view.ratio * view.offsetY * factor)
  function clampCamera(goal) {
    const zoom = Math.min(3, Math.max(1, goal.zoom))
    const limitX = (view.spanX / 2) * (1 - 1 / zoom), limitY = (view.spanY / 2) * (1 - 1 / zoom)
    return { zoom, x: Math.max(-limitX, Math.min(limitX, goal.x)), y: Math.max(-limitY, Math.min(limitY, goal.y)) }
  }
  function setCamera(goal, immediate) {
    cameraGoal = clampCamera(goal)
    if (immediate || isReduced()) camera = { ...cameraGoal }
    if (isReduced()) draw(); else wake()
  }

  // ---------------------------------------------------------- primitives --
  function polygon(points, fill, stroke) {
    pen.beginPath()
    points.forEach((point, index) => (index ? pen.lineTo(point.x, point.y) : pen.moveTo(point.x, point.y)))
    pen.closePath()
    if (fill) { pen.fillStyle = fill; pen.fill() }
    if (stroke) { pen.strokeStyle = stroke; pen.lineWidth = 0.6; pen.stroke() }
  }
  const floorQuad = (x0, y0, x1, y1, fill, stroke) => polygon([toScreen(x0, y0), toScreen(x1, y0), toScreen(x1, y1), toScreen(x0, y1)], fill, stroke)
  // A box on the floor grid: faces are [top, the side facing +gy, the side facing +gx].
  function prism(gx, gy, width, depth, height, elevation, faces) {
    const top = elevation + height
    const backTop = toScreen(gx, gy, top), rightTop = toScreen(gx + width, gy, top)
    const frontTop = toScreen(gx + width, gy + depth, top), leftTop = toScreen(gx, gy + depth, top)
    const front = toScreen(gx + width, gy + depth, elevation), left = toScreen(gx, gy + depth, elevation), right = toScreen(gx + width, gy, elevation)
    polygon([leftTop, frontTop, front, left], faces[1])
    polygon([rightTop, frontTop, front, right], faces[2])
    polygon([backTop, rightTop, frontTop, leftTop], faces[0])
  }
  function block(x, y, width, height, radius, fill) {
    pen.beginPath()
    pen.roundRect(x, y, width, height, radius)
    pen.fillStyle = fill
    pen.fill()
  }
  function disc(x, y, radiusX, radiusY, fill) {
    pen.beginPath()
    pen.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2)
    pen.fillStyle = fill
    pen.fill()
  }
  // Draws on the face of a box that looks toward +gy: u runs 0..1 along it, v 0..1 up it.
  function onFrontFace(gx, gy, width, elevation, height, paint) {
    const origin = toScreen(gx, gy, elevation)
    pen.save()
    pen.transform(width * TILE_X, width * TILE_Y, 0, -height, origin.x, origin.y)
    paint()
    pen.restore()
  }
  // Draws flat on the back wall: x in pixels along the wall from gx, y in pixels down from height top.
  function onBackWall(gx, top, paint, gy = 0.02) {
    const origin = toScreen(gx, gy, top)
    pen.save()
    pen.transform(TILE_X / SLANT, TILE_Y / SLANT, 0, 1, origin.x, origin.y)
    paint()
    pen.restore()
  }
  // Draws flat on the left wall, read from the room: x runs from gy toward the back wall.
  function onLeftWall(gy, top, paint, gx = 0.02) {
    const origin = toScreen(gx, gy, top)
    pen.save()
    pen.transform(TILE_X / SLANT, -TILE_Y / SLANT, 0, 1, origin.x, origin.y)
    paint()
    pen.restore()
  }
  function glow(x, y, radius, color, strength) {
    const gradient = pen.createRadialGradient(x, y, 1, x, y, radius)
    gradient.addColorStop(0, alpha(color, strength))
    gradient.addColorStop(1, alpha(color, 0))
    pen.fillStyle = gradient
    pen.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  // --------------------------------------------------------------- floor --
  // The floor, the walls and the rugs, drawn once into a cache until the room,
  // the theme, the view or the hour changes.
  function renderFloor() {
    const hourBucket = Math.floor(Date.now() / 600_000)
    const key = [layout.key, view.cssWidth, view.cssHeight, view.ratio, view.scale.toFixed(4), view.offsetX.toFixed(1), view.offsetY.toFixed(1), colors.isDark, colors.floorA, hourBucket].join('|')
    if (floorCache && key === floorCacheKey) return
    floorCacheKey = key
    floorCache = floorCache || document.createElement('canvas')
    floorCache.width = canvas.width
    floorCache.height = canvas.height
    const target = floorCache.getContext('2d')
    target.setTransform(1, 0, 0, 1, 0, 0)
    target.clearRect(0, 0, floorCache.width, floorCache.height)
    worldTransform(target)
    pen = target
    const { floorWidth, floorDepth, corridorY, utilityX } = layout
    prism(0, 0, floorWidth, floorDepth, 8, -8, colors.floorEdge)
    // Wooden planks running along the room, staggered.
    for (let gy = 0; gy < floorDepth; gy += 0.5) {
      const rowIndex = Math.round(gy * 2)
      const offset = (hashOf('row' + rowIndex) % 7) * 0.31
      floorQuad(0, gy, floorWidth, gy + 0.5, rowIndex % 2 ? colors.plankA : colors.plankB)
      pen.strokeStyle = alpha(colors.plankLine, 0.35)
      pen.lineWidth = 0.5
      for (let gx = offset; gx < floorWidth; gx += 2.2) {
        const from = toScreen(gx, gy), to = toScreen(gx, gy + 0.5)
        pen.beginPath(); pen.moveTo(from.x, from.y); pen.lineTo(to.x, to.y); pen.stroke()
      }
    }
    // Sunlight from the windows on the floor, moving with the hour.
    const daylight = 1 - nightness
    if (daylight > 0.05) {
      const hour = new Date().getHours() + new Date().getMinutes() / 60
      const lean = Math.max(-1, Math.min(1, (hour - 13) / 5))
      pen.globalAlpha = 0.5 * daylight
      for (const [from, to] of layout.backWindows) {
        polygon([toScreen(from + lean * 0.3, 0.15), toScreen(to + lean * 0.3, 0.15), toScreen(to + lean * 1.5, 2.1), toScreen(from + lean * 1.5, 2.1)], colors.isDark ? 'rgba(255,240,200,.08)' : 'rgba(255,246,214,.55)')
      }
      for (const [from, to] of layout.leftWindows) {
        polygon([toScreen(0.15, from - lean * 0.3), toScreen(0.15, to - lean * 0.3), toScreen(2.0, to + 0.6), toScreen(2.0, from + 0.6)], colors.isDark ? 'rgba(255,240,200,.08)' : 'rgba(255,246,214,.5)')
      }
      pen.globalAlpha = 1
    }
    // The lounge rug with a border, and the tiled floor of the utility corner.
    const rug = mix(colors.floorA, colors.accent, colors.isDark ? 0.18 : 0.14)
    floorQuad(0.6, 2.75, 4.5, corridorY - 0.5, mix(rug, colors.text, 0.12))
    floorQuad(0.72, 2.87, 4.38, corridorY - 0.62, rug)
    floorQuad(0.95, 3.1, 4.15, corridorY - 0.85, null, alpha(colors.label, 0.55))
    for (let gx = Math.floor(utilityX); gx < floorWidth; gx++) {
      for (let gy = 0; gy < Math.ceil(layout.rackDepth + 1.4); gy++) floorQuad(Math.max(gx, utilityX - 0.2), gy, gx + 1, gy + 1, (gx + gy) % 2 ? mix(colors.floorA, colors.metal[2], 0.24) : mix(colors.floorB, colors.metal[2], 0.3))
    }
    // One rug per project, in its colour.
    for (const segment of layout.segments) {
      const tint = mix(colors.floorA, segment.color, colors.isDark ? 0.26 : 0.2)
      floorQuad(segment.x0 - 0.95, segment.gy - 0.7, segment.x1 + 0.95, segment.gy + 1.5, mix(tint, segment.color, 0.25))
      floorQuad(segment.x0 - 0.85, segment.gy - 0.6, segment.x1 + 0.85, segment.gy + 1.4, tint)
    }
    // Walls: the left one along gy, the back one along gx, with a skirting board.
    polygon([toScreen(0, 0), toScreen(0, floorDepth), toScreen(0, floorDepth, WALL_HEIGHT), toScreen(0, 0, WALL_HEIGHT)], colors.wallLeft, colors.border)
    polygon([toScreen(0, 0), toScreen(floorWidth, 0), toScreen(floorWidth, 0, WALL_HEIGHT), toScreen(0, 0, WALL_HEIGHT)], colors.wallBack, colors.border)
    polygon([toScreen(0, 0), toScreen(floorWidth, 0), toScreen(floorWidth, 0, 4), toScreen(0, 0, 4)], mix(colors.wallBack, colors.text, 0.12))
    polygon([toScreen(0, 0), toScreen(0, floorDepth), toScreen(0, floorDepth, 4), toScreen(0, 0, 4)], mix(colors.wallLeft, colors.text, 0.1))
    polygon([toScreen(0, 0, WALL_HEIGHT), toScreen(floorWidth, 0, WALL_HEIGHT), toScreen(floorWidth, -0.25, WALL_HEIGHT), toScreen(-0.25, -0.25, WALL_HEIGHT), toScreen(-0.25, floorDepth, WALL_HEIGHT), toScreen(0, floorDepth, WALL_HEIGHT)], colors.wallTop)
    // The door, in the left wall at the corridor.
    polygon([toScreen(0, corridorY - 0.55), toScreen(0, corridorY + 0.55), toScreen(0, corridorY + 0.55, 58), toScreen(0, corridorY - 0.55, 58)], colors.wood[1], colors.border)
    polygon([toScreen(0, corridorY - 0.42), toScreen(0, corridorY + 0.42), toScreen(0, corridorY + 0.42, 50), toScreen(0, corridorY - 0.42, 50)], null, alpha(colors.wood[2], 0.8))
    const handle = toScreen(0, corridorY + 0.35, 28)
    disc(handle.x, handle.y, 1.6, 1.6, colors.metal[2])
    // A doormat.
    floorQuad(0.05, corridorY - 0.45, 0.75, corridorY + 0.45, mix(colors.floorA, colors.text, 0.22))
    // Zone names.
    target.font = '600 11px -apple-system, system-ui, sans-serif'
    target.fillStyle = colors.muted
    target.textAlign = 'center'
    const rackLabel = toScreen(utilityX + 1.5, layout.rackDepth + 1.75)
    target.fillText('Server racks', rackLabel.x, rackLabel.y)
    pen = mainPen
  }

  // ---------------------------------------------------------------- walls --
  // Windows look out on a city that follows the time of day; drawn every
  // frame because the clouds drift.
  function skyColors() {
    const day = ['#8fc4f2', '#dcecfa'], night = ['#0a1430', '#1d2a4c'], dusk = ['#5d5a8f', '#f0a477']
    const middle = 1 - Math.abs(nightness - 0.5) * 2
    const top = nightness < 0.5 ? mix(day[0], dusk[0], nightness * 2) : mix(dusk[0], night[0], (nightness - 0.5) * 2)
    const bottom = nightness < 0.5 ? mix(day[1], dusk[1], nightness * 2) : mix(dusk[1], night[1], (nightness - 0.5) * 2)
    return { top, bottom, middle }
  }
  function paintView(width, height, startAt, seed) {
    // Painted in pixels, y down, width x height; startAt places the window in the shared skyline.
    const sky = skyColors()
    const gradient = pen.createLinearGradient(0, 0, 0, height)
    gradient.addColorStop(0, sky.top)
    gradient.addColorStop(1, sky.bottom)
    pen.fillStyle = gradient
    pen.fillRect(0, 0, width, height)
    if (nightness > 0.6) {
      for (let star = 0; star < 6; star++) {
        const starSeed = hashOf(seed + ':star' + star)
        const twinkle = isReduced() ? 0.7 : 0.45 + 0.45 * Math.sin(clockSeconds * 2 + star)
        pen.fillStyle = `rgba(255,255,255,${twinkle * (nightness - 0.5) * 2})`
        pen.fillRect((starSeed % 1000) / 1000 * width, ((starSeed >> 10) % 1000) / 1000 * height * 0.45, 0.9, 0.9)
      }
    }
    if (seed === 'sun') {
      const isSun = nightness < 0.5
      disc(width * 0.72, height * 0.3, 4.5, 4.5, isSun ? 'rgba(255,236,160,.95)' : 'rgba(240,240,225,.9)')
      if (!isSun) disc(width * 0.72 + 1.8, height * 0.3 - 1.2, 3.8, 3.8, sky.top)
    }
    if (nightness < 0.8) {
      for (let cloud = 0; cloud < 2; cloud++) {
        const cloudSeed = hashOf(seed + ':cloud' + cloud)
        const travel = isReduced() ? 0 : clockSeconds * (2 + (cloudSeed % 3))
        const x = ((startAt * 0.4 + (cloudSeed % 300) + travel) % (width + 60)) - 30
        const y = 5 + ((cloudSeed >> 8) % 12)
        pen.fillStyle = `rgba(255,255,255,${0.75 * (1 - nightness)})`
        disc(x, y, 9, 3.2, pen.fillStyle); disc(x + 6, y - 2, 6, 3, pen.fillStyle)
      }
    }
    // The skyline: buildings at fixed places along the whole wall, so every window shows the same city.
    const buildingColor = nightness > 0.5 ? mix('#26314f', '#121a33', (nightness - 0.5) * 2) : mix('#9fb3c8', '#6d7e99', nightness * 2)
    for (let index = Math.floor(startAt / 9) - 1; index * 9 < startAt + width + 9; index++) {
      const buildingSeed = hashOf('building' + index)
      const x = index * 9 - startAt
      const tall = height * (0.28 + ((buildingSeed % 100) / 100) * 0.42)
      const wide = 7 + (buildingSeed >> 7) % 5
      pen.fillStyle = buildingColor
      pen.fillRect(x, height - tall, wide, tall)
      if (nightness > 0.4) {
        for (let litRow = 0; litRow * 4 < tall - 4; litRow++) {
          for (let litColumn = 0; litColumn < 2; litColumn++) {
            const windowSeed = hashOf(buildingSeed + ':' + litRow + ':' + litColumn)
            if (windowSeed % 3) continue
            pen.fillStyle = `rgba(255,214,140,${0.85 * nightness})`
            pen.fillRect(x + 1.5 + litColumn * 3, height - tall + 2 + litRow * 4, 1.3, 1.6)
          }
        }
      }
    }
  }
  function drawWindows() {
    const height = 38
    layout.backWindows.forEach(([from, to], index) => {
      const width = (to - from) * SLANT
      onBackWall(from, 72, () => {
        pen.save()
        pen.beginPath(); pen.rect(0, 0, width, height); pen.clip()
        paintView(width, height, from * SLANT, index === 1 ? 'sun' : 'back' + index)
        pen.restore()
        pen.strokeStyle = colors.border; pen.lineWidth = 1.4
        pen.strokeRect(0, 0, width, height)
        pen.fillStyle = colors.border
        pen.fillRect(width / 2 - 0.7, 0, 1.4, height)
        pen.fillStyle = mix(colors.wallBack, colors.text, 0.15)
        pen.fillRect(-2, height, width + 4, 2.4)
      })
    })
    layout.leftWindows.forEach(([from, to], index) => {
      const width = (to - from) * SLANT
      onLeftWall(to, 72, () => {
        pen.save()
        pen.beginPath(); pen.rect(0, 0, width, height); pen.clip()
        paintView(width, height, 400 + index * 80, 'left' + index)
        pen.restore()
        pen.strokeStyle = colors.border; pen.lineWidth = 1.4
        pen.strokeRect(0, 0, width, height)
        pen.fillStyle = colors.border
        pen.fillRect(width / 2 - 0.7, 0, 1.4, height)
      })
    })
  }
  function drawClock() {
    // A wall clock showing the real time, between the lounge and the desks.
    onBackWall(LOUNGE_WIDTH + 0.55, 76, () => {
      disc(0, 0, 10.5, 10.5, colors.dark[1])
      disc(0, 0, 9, 9, colors.label)
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
      if (!isReduced()) hand((date.getSeconds() / 60) * Math.PI * 2, 7.4, 0.5, colors.critical)
      disc(0, 0, 1, 1, colors.text)
    }, 0.02)
  }
  function drawPlanBoard() {
    // A board on the back wall above the sofa with the plan's usage windows.
    const from = 0.9, to = 4.5
    const width = (to - from) * SLANT
    onBackWall(from, 80, () => {
      block(0, 0, width, 52, 2, colors.label)
      pen.strokeStyle = colors.border; pen.lineWidth = 1; pen.strokeRect(0, 0, width, 52)
      pen.fillStyle = colors.text
      pen.font = '700 11px -apple-system, system-ui, sans-serif'
      pen.textAlign = 'left'
      pen.fillText('Plan usage', 8, 15)
      pen.font = '9.5px -apple-system, system-ui, sans-serif'
      if (!planLimits.length) {
        pen.fillStyle = colors.muted
        pen.fillText('shows once a session reports in', 8, 32)
      }
      planLimits.slice(0, 2).forEach((limit, index) => {
        const rowTop = 20 + index * 16
        const percent = Math.min(100, Math.round(limit.percentUsed))
        const name = { five_hour: '5-hour', seven_day: '7-day', seven_day_opus: '7-day Opus' }[limit.kind] || String(limit.kind).replace(/_/g, ' ')
        pen.fillStyle = colors.muted
        const resets = limit.resetsAt ? resetsIn(limit.resetsAt).split(' · ')[0].replace(/^resets /i, '') : ''
        pen.fillText(`${name} ${percent}%${resets ? ' · ' + resets : ''}`, 8, rowTop + 7)
        block(8, rowTop + 10, width - 16, 3.5, 1.5, colors.border)
        block(8, rowTop + 10, Math.max(2, (width - 16) * percent / 100), 3.5, 1.5, percent >= 90 ? colors.critical : percent >= 80 ? colors.warning : colors.accent)
      })
    })
  }
  function drawWhiteboard() {
    // What the sessions in the office have done, on the left wall.
    const from = 1.3, to = 3.6
    const width = (to - from) * SLANT
    onLeftWall(to, 76, () => {
      block(-2, -2, width + 4, 50, 2, colors.metal[1])
      block(0, 0, width, 46, 1.5, colors.isDark ? '#e9ebee' : '#ffffff')
      pen.textAlign = 'left'
      pen.fillStyle = '#2a2d33'
      pen.font = '700 10.5px -apple-system, system-ui, sans-serif'
      pen.fillText('Live sessions', 7, 13)
      pen.font = '9px -apple-system, system-ui, sans-serif'
      pen.fillStyle = '#3d4250'
      pen.fillText(`${today.commits} commit${today.commits === 1 ? '' : 's'} · ${today.pushes} push${today.pushes === 1 ? '' : 'es'}`, 7, 26)
      pen.fillText(`${today.prompts} prompt${today.prompts === 1 ? '' : 's'} · ${today.working} working now`, 7, 38)
      block(width - 26, 40, 8, 2.5, 1, colors.critical)
      block(width - 16, 40, 8, 2.5, 1, colors.accent)
    })
  }
  function drawPoster() {
    // Framed art above the bookshelf.
    const from = layout.utilityX + 0.35, to = layout.utilityX + 1.45
    const width = (to - from) * SLANT
    onBackWall(from, 80, () => {
      block(0, 0, width, 26, 1.5, colors.dark[1])
      block(2, 2, width - 4, 22, 1, colors.isDark ? '#e7e2d6' : '#f6f1e6')
      disc(width * 0.35, 13, 6, 6, colors.shirts[3])
      block(width * 0.5, 7, 9, 12, 1, colors.shirts[0])
      polygon([{ x: width * 0.62, y: 20 }, { x: width * 0.86, y: 20 }, { x: width * 0.74, y: 6 }], colors.shirts[2])
    })
  }

  // ------------------------------------------------------------ furniture --
  function drawLounge() {
    // Counter with the coffee machine in the corner, the plan board, the sofa.
    prism(0.15, 0.2, 0.8, 0.65, 22, 0, colors.wood)
    prism(0.3, 0.3, 0.45, 0.4, 18, 22, colors.dark)
    const light = toScreen(0.5, 0.7, 34)
    disc(light.x, light.y, 1.3, 1.3, colors.critical)
    lights.push({ x: light.x, y: light.y, radius: 18, strength: 0.6, warm: false })
    const mug = toScreen(0.72, 0.62, 22)
    block(mug.x - 2, mug.y - 4, 4, 4, 1, colors.label)
    drawPlanBoard()
    prism(1.15, 1.4, 2.7, 0.32, 26, 0, colors.sofa)
    prism(1.15, 1.72, 2.7, 0.62, 11, 0, colors.sofa)
    prism(1.0, 1.4, 0.18, 0.94, 17, 0, colors.sofa)
    prism(3.85, 1.4, 0.18, 0.94, 17, 0, colors.sofa)
    // Cushions.
    prism(1.35, 1.48, 0.5, 0.16, 12, 14, [mix(colors.sofa[0], colors.label, 0.45), mix(colors.sofa[1], colors.label, 0.4), mix(colors.sofa[2], colors.label, 0.35)])
    prism(3.15, 1.48, 0.5, 0.16, 12, 14, [mix(colors.shirts[3], colors.label, 0.3), shade(colors.shirts[3], 0.1), shade(colors.shirts[3], 0.2)])
  }
  function drawFloorLamp(gx, gy) {
    prism(gx - 0.12, gy - 0.12, 0.24, 0.24, 2, 0, colors.dark)
    prism(gx - 0.02, gy - 0.02, 0.04, 0.04, 42, 2, colors.dark)
    const shadeTop = toScreen(gx, gy, 54)
    const lit = nightness > 0.3
    polygon([{ x: shadeTop.x - 6, y: shadeTop.y }, { x: shadeTop.x + 6, y: shadeTop.y }, { x: shadeTop.x + 9, y: shadeTop.y + 10 }, { x: shadeTop.x - 9, y: shadeTop.y + 10 }], lit ? '#f7e2b5' : mix(colors.label, colors.wood[0], 0.4))
    if (lit) lights.push({ x: shadeTop.x, y: shadeTop.y + 40, radius: 95, strength: 0.85, warm: true })
  }
  function drawWaterCooler(gx, gy) {
    prism(gx - 0.2, gy - 0.2, 0.4, 0.4, 24, 0, colors.metal)
    const bottle = toScreen(gx, gy, 24)
    block(bottle.x - 5, bottle.y - 13, 10, 13, 4, colors.isDark ? 'rgba(110,170,230,.7)' : 'rgba(120,180,240,.75)')
    block(bottle.x - 1.5, bottle.y - 16, 3, 3, 1, colors.isDark ? '#6aa0d8' : '#78b4f0')
  }
  function drawPingPong() {
    const table = { gx: 1.55, gy: 3.42, width: 1.95, depth: 0.95 }
    for (const [legX, legY] of [[0.1, 0.1], [1.8, 0.1], [0.1, 0.8], [1.8, 0.8]]) prism(table.gx + legX, table.gy + legY, 0.05, 0.05, 15, 0, colors.dark)
    prism(table.gx, table.gy, table.width, table.depth, 1.6, 15, colors.table)
    const lineFrom = toScreen(table.gx, table.gy + table.depth / 2, 16.7), lineTo = toScreen(table.gx + table.width, table.gy + table.depth / 2, 16.7)
    pen.strokeStyle = 'rgba(255,255,255,.75)'; pen.lineWidth = 0.6
    pen.beginPath(); pen.moveTo(lineFrom.x, lineFrom.y); pen.lineTo(lineTo.x, lineTo.y); pen.stroke()
    // The net across the middle.
    const middle = table.gx + table.width / 2
    polygon([toScreen(middle, table.gy - 0.05, 16.6), toScreen(middle, table.gy + table.depth + 0.05, 16.6), toScreen(middle, table.gy + table.depth + 0.05, 22), toScreen(middle, table.gy - 0.05, 22)], 'rgba(240,240,240,.7)', colors.dark[1])
    // A rally while both ends are taken.
    const players = [...people.values()].filter(person => person.target?.pose === 'pong' && !person.path.length && !person.leaving)
    if (players.length === 2 && !isReduced()) {
      const travel = (Math.sin(clockSeconds * 2.6) + 1) / 2
      const gx = table.gx + 0.2 + travel * (table.width - 0.4)
      const bounce = Math.abs(Math.sin(clockSeconds * 5.2)) * 14
      const ball = toScreen(gx, table.gy + table.depth / 2 + 0.05, 18 + bounce)
      disc(ball.x, ball.y, 1.6, 1.6, '#ffffff')
      const ground = toScreen(gx, table.gy + table.depth / 2 + 0.05, 16.8)
      disc(ground.x, ground.y, 1.6, 0.7, 'rgba(0,0,0,.25)')
    }
  }
  function drawPlant(gx, gy, size = 1) {
    prism(gx - 0.18 * size, gy - 0.18 * size, 0.36 * size, 0.36 * size, 12 * size, 0, colors.pot)
    const center = toScreen(gx, gy, 24 * size)
    for (const [offsetX, offsetY, radius] of [[-5, 2, 7], [5, 1, 7], [0, -6, 8], [-2, 5, 6], [3, -1, 6]]) disc(center.x + offsetX * size, center.y + offsetY * size, radius * size, radius * 0.85 * size, colors.leaf)
    disc(center.x - 2 * size, center.y + 1 * size, 3 * size, 2.4 * size, colors.leafDark)
  }
  function drawTallPlant(gx, gy) {
    prism(gx - 0.2, gy - 0.2, 0.4, 0.4, 16, 0, colors.pot)
    const base = toScreen(gx, gy, 16)
    pen.strokeStyle = colors.leafDark; pen.lineWidth = 1.2
    for (const [angle, length] of [[-0.5, 30], [0.1, 38], [0.6, 28], [-0.15, 24], [0.35, 34]]) {
      pen.beginPath(); pen.moveTo(base.x, base.y); pen.lineTo(base.x + Math.sin(angle) * length, base.y - Math.cos(angle) * length); pen.stroke()
      disc(base.x + Math.sin(angle) * length, base.y - Math.cos(angle) * length, 6, 3.4, colors.leaf)
      disc(base.x + Math.sin(angle) * length * 0.6, base.y - Math.cos(angle) * length * 0.6, 4.5, 2.6, colors.leafDark)
    }
  }
  function drawBookshelf() {
    const { gx, gy } = layout.bookshelf
    prism(gx, gy, 1.6, 0.42, 50, 0, colors.wood)
    onFrontFace(gx, gy + 0.42, 1.6, 0, 50, () => {
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
  function drawGlobe() {
    const { gx, gy } = layout.globe
    prism(gx - 0.18, gy - 0.18, 0.36, 0.36, 3, 0, colors.wood)
    prism(gx - 0.02, gy - 0.02, 0.04, 0.04, 20, 3, colors.wood)
    const center = toScreen(gx, gy, 32)
    const spin = isReduced() ? 0 : clockSeconds * (people.size && [...people.values()].some(person => person.trip?.kind === 'globe' && !person.path.length) ? 1.6 : 0.25)
    disc(center.x, center.y, 9, 9, colors.isDark ? '#2f6aa3' : '#5aa0e0')
    pen.save()
    pen.beginPath(); pen.ellipse(center.x, center.y, 9, 9, 0, 0, Math.PI * 2); pen.clip()
    for (let land = 0; land < 4; land++) {
      const x = center.x - 14 + (((land * 9 + spin * 6) % 36) + 36) % 36
      disc(x, center.y - 3 + (land % 2) * 6, 4.5, 3, colors.isDark ? '#4e9a5a' : '#69b86f')
    }
    pen.restore()
    pen.strokeStyle = colors.wood[2]; pen.lineWidth = 1.2
    pen.beginPath(); pen.ellipse(center.x, center.y, 11, 11, 0, -1.2, 1.9); pen.stroke()
  }
  function drawPrinter() {
    const { gx, gy } = layout.printer
    prism(gx, gy, 0.8, 0.6, 18, 0, colors.wood)
    prism(gx + 0.08, gy + 0.08, 0.64, 0.46, 9, 18, colors.metal)
    // The outbox tray on top, holding the parcels that arrived.
    prism(gx + 0.14, gy + 0.14, 0.5, 0.34, 1.5, 27, colors.dark)
    for (let parcel = 0; parcel < Math.min(4, outboxCount); parcel++) {
      prism(gx + 0.18 + (parcel % 2) * 0.22, gy + 0.18, 0.18, 0.16, 5, 28.5 + Math.floor(parcel / 2) * 5, ['#d8b07a', '#c49663', '#b08454'])
    }
    const label = toScreen(gx + 0.4, gy + 0.6, 6)
    pen.fillStyle = colors.muted; pen.font = '600 7px -apple-system, system-ui, sans-serif'; pen.textAlign = 'center'
    pen.fillText('Outbox', label.x + 6, label.y + 2)
  }
  function drawShredder() {
    const { gx, gy } = layout.shredder
    prism(gx, gy, 0.55, 0.45, 20, 0, colors.dark)
    prism(gx + 0.05, gy + 0.05, 0.45, 0.35, 3, 20, colors.metal)
    const shredding = [...people.values()].some(person => person.errand?.kind === 'shred' && person.errand.phase === 'staying')
    if (shredding && !isReduced()) {
      const mouth = toScreen(gx + 0.27, gy + 0.45, 14)
      for (let strip = 0; strip < 5; strip++) {
        const fall = ((clockSeconds * 22 + strip * 4) % 12)
        block(mouth.x - 5 + strip * 2.2, mouth.y + fall - 6, 1.2, 4, 0.4, colors.paper[0])
      }
    }
    const light = toScreen(gx + 0.45, gy + 0.45, 18)
    disc(light.x, light.y, 1, 1, shredding ? colors.good : colors.metal[2])
  }
  const SCREEN = {
    off: '#1b1d21', code: '#1e2430', terminal: '#0d1117', read: '#f4f4f1', think: '#1e2430', waiting: '#3a2a0a', supervise: '#18202c',
  }
  function drawScreen(mode, seed, contextPercent) {
    // Painted in the unit square of the monitor's face, v pointing up.
    pen.fillStyle = SCREEN[mode] || SCREEN.off
    pen.fillRect(0.05, 0.1, 0.9, 0.84)
    const t = clockSeconds
    if (mode === 'code' || mode === 'terminal') {
      const palette = mode === 'code' ? ['#7fb4ff', '#c3e88d', '#f78c6c', '#d6d6d6', '#c792ea'] : ['#3fb950', '#3fb950', '#8b949e', '#3fb950']
      const scroll = isReduced() ? 0 : Math.floor(t * (mode === 'terminal' ? 5 : 2.5))
      for (let line = 0; line < 7; line++) {
        const lineSeed = hashOf(seed + ':' + (line + scroll))
        const indent = mode === 'code' ? ((lineSeed >> 3) % 3) * 0.08 : 0
        const length = 0.18 + ((lineSeed >> 7) % 50) / 100
        pen.fillStyle = palette[lineSeed % palette.length]
        pen.fillRect(0.1 + indent, 0.84 - line * 0.1, Math.min(0.8 - indent, length), 0.045)
      }
      if (!isReduced() && Math.floor(t * 2) % 2) { pen.fillStyle = '#e6e6e6'; pen.fillRect(0.12, 0.84 - 7 * 0.1 + 0.02, 0.05, 0.05) }
    } else if (mode === 'read') {
      for (let line = 0; line < 7; line++) {
        pen.fillStyle = '#b9b9b4'
        pen.fillRect(0.12, 0.84 - line * 0.1, 0.5 + ((hashOf(seed + line) >> 4) % 25) / 100, 0.04)
      }
      const band = isReduced() ? 0.5 : 0.84 - ((t * 0.12) % 0.7)
      pen.fillStyle = 'rgba(42,120,214,.25)'
      pen.fillRect(0.08, band - 0.03, 0.84, 0.1)
    } else if (mode === 'think') {
      for (let dot = 0; dot < 3; dot++) {
        pen.fillStyle = `rgba(200,210,230,${isReduced() ? 0.8 : 0.35 + 0.65 * Math.max(0, Math.sin(t * 4 - dot * 0.8))})`
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
      cells.forEach(([u, v], index) => {
        pen.fillStyle = index % 2 ? '#25344a' : '#2a3d2f'
        pen.fillRect(u, v, 0.38, 0.34)
        pen.fillStyle = index % 2 ? '#7fb4ff' : '#3fb950'
        const progress = isReduced() ? 0.6 : (t * 0.2 + index * 0.27) % 1
        pen.fillRect(u + 0.04, v + 0.05, 0.3 * progress, 0.04)
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
  function drawDesk(desk, owner) {
    const { gx, gy } = desk
    const legs = colors.metal
    for (const [legX, legY] of [[-0.64, -0.3], [0.58, -0.3], [-0.64, 0.24], [0.58, 0.24]]) prism(gx + legX, gy + legY, 0.06, 0.06, 20, 0, legs)
    prism(gx + 0.2, gy - 0.28, 0.4, 0.55, 18, 0, [colors.wood[1], colors.wood[2], shade(colors.wood[2], 0.08)])
    prism(gx - 0.7, gy - 0.35, 1.4, 0.7, 3, 20, colors.wood)
    const mode = screenModeOf(owner)
    const contextPercent = owner?.session?.contextPercent || 0
    const center = toScreen(gx, gy - 0.2, 38)
    if (mode !== 'off') {
      // The screen lights the desk; amber when its context is nearly full.
      const tint = contextPercent >= 80 || mode === 'waiting' ? colors.warning : colors.accent
      glow(center.x, center.y, 46, tint, contextPercent >= 80 ? 0.33 : 0.22)
      lights.push({ x: center.x, y: center.y + 6, radius: 48, strength: 0.7, warm: false })
    }
    // The paper pile on the left grows with the context used.
    const sheets = owner && !owner.leaving && !(owner.errand?.kind === 'shred') ? Math.round(Math.min(100, contextPercent) / 9) : 0
    for (let sheet = 0; sheet < sheets; sheet++) {
      const jitter = ((hashOf(owner.key + sheet) % 7) - 3) * 0.01
      prism(gx - 0.62 + jitter, gy - 0.02 - jitter, 0.3, 0.22, 1.1, 23 + sheet * 1.1, colors.paper)
    }
    // The desk lamp at the back right, lit at night while someone is here.
    prism(gx + 0.48, gy - 0.3, 0.1, 0.1, 1, 23, colors.dark)
    const lampTop = toScreen(gx + 0.53, gy - 0.25, 36)
    const lampBase = toScreen(gx + 0.53, gy - 0.25, 24)
    pen.strokeStyle = colors.dark[0]; pen.lineWidth = 1
    pen.beginPath(); pen.moveTo(lampBase.x, lampBase.y); pen.lineTo(lampTop.x + 2, lampTop.y); pen.lineTo(lampTop.x - 2, lampTop.y + 2); pen.stroke()
    const lampLit = nightness > 0.35 && owner && !owner.leaving && !owner.isAway
    disc(lampTop.x - 2.5, lampTop.y + 2.5, 3, 2, lampLit ? '#ffe2a6' : colors.dark[0])
    if (lampLit) {
      glow(lampTop.x - 3, lampTop.y + 10, 30, '#ffc978', 0.35 * nightness)
      lights.push({ x: lampTop.x - 3, y: lampTop.y + 16, radius: 62, strength: 0.9, warm: true })
    }
    prism(gx - 0.06, gy - 0.26, 0.12, 0.08, 6, 23, colors.dark)
    prism(gx - 0.46, gy - 0.32, 0.92, 0.06, 22, 28, colors.dark)
    onFrontFace(gx - 0.46, gy - 0.26, 0.92, 28, 22, () => drawScreen(mode, owner?.key || String(gx + gy), contextPercent))
    // A pennant on the monitor in the colour of its branch.
    if (owner?.session?.branch && !owner.leaving) {
      const pole = toScreen(gx + 0.44, gy - 0.3, 50)
      pen.strokeStyle = colors.dark[0]; pen.lineWidth = 0.8
      pen.beginPath(); pen.moveTo(pole.x, pole.y); pen.lineTo(pole.x, pole.y - 9); pen.stroke()
      polygon([{ x: pole.x, y: pole.y - 9 }, { x: pole.x + 7, y: pole.y - 6.5 }, { x: pole.x, y: pole.y - 4 }], colors.shirts[hashOf(owner.session.branch) % colors.shirts.length])
    }
    prism(gx - 0.3, gy + 0.02, 0.6, 0.17, 1.5, 23, [colors.metal[0], colors.metal[1], colors.metal[2]])
    drawShellBoxes(desk, owner)
    if (!(owner?.errand?.kind === 'coffee')) {
      const mug = toScreen(gx + 0.48, gy + 0.12, 23)
      block(mug.x - 2, mug.y - 5, 4, 5, 1, colors.label)
    }
  }
  // One small humming box per background shell, stacked on the floor at the back left of the desk.
  function drawShellBoxes(desk, owner) {
    const shells = owner && !owner.leaving ? owner.session?.shells || [] : []
    shells.slice(0, 3).forEach((shell, index) => {
      const gx = desk.gx - 1.0, gy = desk.gy - 0.42, elevation = index * 9
      prism(gx, gy, 0.3, 0.28, 8.5, elevation, colors.dark)
      onFrontFace(gx, gy + 0.28, 0.3, elevation, 8.5, () => {
        const seed = hashOf(shell.id)
        const isOn = isReduced() || Math.sin(clockSeconds * (4 + (seed % 4)) + seed) > -0.3
        pen.fillStyle = isOn ? '#3fb950' : 'rgba(63,185,80,.25)'
        pen.fillRect(0.12, 0.55, 0.14, 0.22)
        pen.fillStyle = 'rgba(63,185,80,.55)'
        const scroll = isReduced() ? 0 : Math.floor(clockSeconds * 3)
        for (let line = 0; line < 2; line++) pen.fillRect(0.38, 0.62 - line * 0.28, 0.2 + ((hashOf(seed + ':' + (line + scroll)) >> 3) % 30) / 100, 0.1)
      })
      const point = toScreen(gx + 0.15, gy + 0.28, elevation + 5)
      lights.push({ x: point.x, y: point.y, radius: 16, strength: 0.5, warm: false })
    })
    if (shells.length > 3) {
      const point = toScreen(desk.gx - 0.85, desk.gy - 0.28, 30)
      pen.fillStyle = colors.muted; pen.font = '700 8px -apple-system, system-ui, sans-serif'; pen.textAlign = 'center'
      pen.fillText(`+${shells.length - 3}`, point.x, point.y)
    }
  }
  function drawChair(desk, part) {
    const seatX = desk.gx - 0.22, seatY = desk.gy + 0.66
    if (part === 'seat') {
      prism(desk.gx - 0.03, seatY + 0.18, 0.06, 0.06, 10, 0, colors.dark)
      prism(seatX, seatY, 0.44, 0.44, 3, 10, colors.dark)
    } else {
      prism(seatX, seatY + 0.4, 0.44, 0.06, 10, 13, colors.dark)
    }
  }
  function drawRack(rack, robot) {
    prism(rack.gx - 0.4, rack.gy - 0.3, 0.8, 0.6, 62, 0, colors.dark)
    const status = robot && !robot.leaving ? robot.activity : 'off'
    onFrontFace(rack.gx - 0.4, rack.gy + 0.3, 0.8, 0, 62, () => {
      for (let row = 0; row < 9; row++) {
        pen.fillStyle = 'rgba(255,255,255,.06)'
        pen.fillRect(0.08, 0.9 - row * 0.095, 0.84, 0.07)
        for (let led = 0; led < 3; led++) {
          const seed = hashOf(rack.gx + ':' + rack.gy + ':' + row + ':' + led)
          const blinking = status !== 'off' && status !== 'idle' && !isReduced()
          const isOn = blinking ? Math.sin(clockSeconds * (3 + (seed % 5)) + seed) > -0.2 : seed % 3 === 0
          pen.fillStyle = isOn ? (status === 'waiting' ? colors.warning : '#3fb950') : 'rgba(255,255,255,.12)'
          pen.fillRect(0.62 + led * 0.1, 0.915 - row * 0.095, 0.06, 0.035)
        }
      }
    })
    const front = toScreen(rack.gx, rack.gy + 0.3, 30)
    lights.push({ x: front.x, y: front.y, radius: 26, strength: 0.4, warm: false })
  }

  // -------------------------------------------------------------- people --
  function drawOutfitBack(person, torsoTop, headY, bob) {
    const outfit = person.outfit
    if (outfit === 'blazer') {
      block(-5, torsoTop - 0.5, 10, 2.6, 1, shade(person.shirt, 0.3))
      pen.strokeStyle = shade(person.shirt, 0.32); pen.lineWidth = 0.8
      pen.beginPath(); pen.moveTo(0, torsoTop + 15); pen.lineTo(0, torsoTop + 9); pen.stroke()
    } else if (outfit === 'hoodie') {
      disc(bob, torsoTop + 1.5, 6.6, 3.8, shade(person.shirt, 0.16))
    }
  }
  function drawOutfitFront(person, torsoTop) {
    const outfit = person.outfit
    if (outfit === 'blazer') {
      polygon([{ x: -3.6, y: torsoTop }, { x: 3.6, y: torsoTop }, { x: 0, y: torsoTop + 8 }], '#f4f3ef')
      polygon([{ x: -0.9, y: torsoTop + 1.5 }, { x: 0.9, y: torsoTop + 1.5 }, { x: 0.6, y: torsoTop + 7 }, { x: 0, y: torsoTop + 8 }, { x: -0.6, y: torsoTop + 7 }], shade(person.shirt, 0.45))
      pen.strokeStyle = shade(person.shirt, 0.3); pen.lineWidth = 0.9
      pen.beginPath(); pen.moveTo(-3.6, torsoTop); pen.lineTo(-1.2, torsoTop + 8.5); pen.moveTo(3.6, torsoTop); pen.lineTo(1.2, torsoTop + 8.5); pen.stroke()
    } else {
      polygon([{ x: -3, y: torsoTop }, { x: 3, y: torsoTop }, { x: 0, y: torsoTop + 4 }], person.skin)
      if (outfit === 'hoodie') {
        pen.strokeStyle = 'rgba(255,255,255,.8)'; pen.lineWidth = 0.7
        pen.beginPath(); pen.moveTo(-1.6, torsoTop + 2); pen.lineTo(-1.6, torsoTop + 7); pen.moveTo(1.6, torsoTop + 2); pen.lineTo(1.6, torsoTop + 7); pen.stroke()
        block(-4.5, torsoTop + 9, 9, 4, 1.5, shade(person.shirt, 0.12))
      }
    }
  }
  function drawHeadwear(person, facing, headY, bob) {
    const outfit = person.outfit
    if (outfit === 'beanie') {
      const knit = mix(person.shirt, '#ffffff', 0.25)
      pen.beginPath(); pen.ellipse(bob, headY - 1.6, 7.6, 7, 0, Math.PI, Math.PI * 2); pen.fillStyle = knit; pen.fill()
      block(bob - 7.7, headY - 2.6, 15.4, 2.8, 1.2, shade(knit, 0.15))
      disc(bob, headY - 9, 2.1, 2.1, shade(knit, 0.05))
    } else if (outfit === 'headphones') {
      pen.strokeStyle = '#2a2b30'; pen.lineWidth = 1.8
      pen.beginPath(); pen.ellipse(bob, headY - 0.5, 7.6, 8, 0, Math.PI, Math.PI * 2); pen.stroke()
      if (facing === 'front') {
        block(bob - 9.2, headY - 2.4, 3.2, 5.6, 1.4, '#2a2b30')
        block(bob + 6, headY - 2.4, 3.2, 5.6, 1.4, '#2a2b30')
      } else {
        block(bob - 9, headY - 2, 3, 5.4, 1.4, '#2a2b30')
        block(bob + 6, headY - 2, 3, 5.4, 1.4, '#2a2b30')
      }
      disc(bob - 7.6, headY + 0.5, 0.9, 0.9, colors.accent)
    }
  }
  function drawCarried(person, facing, torsoTop) {
    if (person.carrying === 'pile') {
      if (facing === 'front') { for (let sheet = 0; sheet < 4; sheet++) block(-6, torsoTop + 7 - sheet * 1.4, 12, 1.6, 0.4, sheet % 2 ? colors.paper[1] : colors.paper[0]) }
      else { for (let sheet = 0; sheet < 3; sheet++) block(-6, torsoTop - 1 - sheet * 1.4, 12, 1.6, 0.4, sheet % 2 ? colors.paper[1] : colors.paper[0]) }
    } else if (person.carrying === 'paper') {
      block(facing === 'front' ? 5 : -10, torsoTop + 8, 6, 7.5, 0.6, colors.paper[0])
    } else if (person.carrying === 'mug') {
      block(facing === 'front' ? 6 : -10, torsoTop + 9, 4.5, 5, 1, colors.label)
    }
  }
  function drawHuman(person, facing, pose, mirror) {
    const t = clockSeconds + person.phase
    const still = isReduced()
    const sitting = pose === 'sit' || pose === 'sofa' || pose === 'stool'
    const hipY = sitting ? -12 : -14
    const breathe = still ? 0 : Math.sin(t * 2) * 0.4
    const shirt = person.shirt, sleeve = shade(person.shirt, 0.12)
    disc(0, 0, 9, 3.6, colors.shadow)
    if (pose === 'walk') {
      const swing = still ? 0 : Math.sin(t * 11) * 3
      block(-5 + swing * 0.5, hipY, 4, -hipY, 1.5, colors.pants)
      block(1 - swing * 0.5, hipY, 4, -hipY, 1.5, colors.pants)
    } else if (pose === 'stand' || pose === 'pong') {
      block(-5, hipY, 4, -hipY, 1.5, colors.pants)
      block(1, hipY, 4, -hipY, 1.5, colors.pants)
    } else if (pose === 'sofa') {
      block(-6, hipY, 5, 8, 2, colors.pants)
      block(1, hipY, 5, 8, 2, colors.pants)
    }
    const torsoTop = hipY - 15 + breathe
    const bob = !still && person.activity === 'reading' && sitting ? Math.sin(t * 1.4) * 0.8 : 0
    const headY = torsoTop - 7
    block(-8, torsoTop, 16, 15, 5, shirt)
    if (facing === 'front') drawOutfitFront(person, torsoTop)
    else drawOutfitBack(person, torsoTop, headY, bob)
    // Arms.
    const activity = person.activity
    if (person.carrying === 'pile') {
      block(-11, torsoTop + 2, 4, 9, 2, sleeve)
      block(7, torsoTop + 2, 4, 9, 2, sleeve)
    } else if (pose === 'pong') {
      block(-11, torsoTop + 2, 4, 12, 2, sleeve)
      const swingAngle = still ? -1.6 : -1.9 + Math.sin(clockSeconds * 2.6 + (person.target.side ? Math.PI : 0)) * 0.6
      pen.save()
      pen.translate(9, torsoTop + 3)
      pen.rotate(swingAngle)
      block(-2, 0, 4, 10, 2, sleeve)
      disc(0, 13, 3.6, 3.6, colors.critical)
      block(-0.8, 9.5, 1.6, 3, 0.5, colors.wood[2])
      pen.restore()
    } else if (facing === 'back' && sitting && ['typing', 'terminal', 'thinking', 'reading', 'supervising'].includes(activity)) {
      const speed = activity === 'terminal' ? 20 : activity === 'typing' ? 15 : 0
      const tapLeft = still || !speed ? 0 : Math.sin(t * speed) * 1.3
      const tapRight = still || !speed ? 0 : Math.sin(t * speed + 2) * 1.3
      block(-11, torsoTop + 2 + tapLeft, 4, 9, 2, sleeve)
      block(7, torsoTop + 2 + tapRight, 4, 9, 2, sleeve)
    } else if (activity === 'waiting' && facing === 'front' && pose !== 'walk') {
      block(-11, torsoTop + 2, 4, 12, 2, sleeve)
      pen.save()
      pen.translate(9, torsoTop + 3)
      const urgent = person.isUrgent && !still
      pen.rotate(-2.6 + (still ? 0 : Math.sin(t * (urgent ? 11 : 7)) * (urgent ? 0.55 : 0.35)))
      block(-2, 0, 4, 12, 2, sleeve)
      disc(0, 13, 2.4, 2.4, person.skin)
      pen.restore()
    } else if ((activity === 'idle' && !person.carrying) && facing === 'front' && pose !== 'walk') {
      block(-11, torsoTop + 2, 4, 12, 2, sleeve)
      disc(-9, torsoTop + 15, 2.2, 2.2, person.skin)
      block(7, torsoTop + 2, 4, 7, 2, sleeve)
      block(3, torsoTop + 7, 8, 4, 2, sleeve)
      block(1, torsoTop + 3, 5, 6, 1, '#f7f5f0')
      if (!still) {
        pen.strokeStyle = 'rgba(160,160,160,.5)'
        pen.lineWidth = 0.8
        pen.beginPath()
        const drift = Math.sin(t * 2.5) * 1.2
        pen.moveTo(3.5, torsoTop + 2); pen.quadraticCurveTo(5 + drift, torsoTop - 1, 3 - drift, torsoTop - 4)
        pen.stroke()
      }
    } else {
      const swing = pose === 'walk' && !still ? Math.sin(t * 11) * 2 : 0
      block(-11, torsoTop + 2 - swing * 0.3, 4, 12, 2, sleeve)
      block(7, torsoTop + 2 + swing * 0.3, 4, 12, 2, sleeve)
      if (facing === 'front') { disc(-9, torsoTop + 15, 2.2, 2.2, person.skin); disc(9, torsoTop + 15, 2.2, 2.2, person.skin) }
    }
    drawCarried(person, facing, torsoTop)
    // Head.
    disc(bob, headY, 7, 7, person.skin)
    if (facing === 'front') {
      pen.beginPath()
      pen.ellipse(bob, headY - 1.4, 7.4, 6.2, 0, Math.PI, Math.PI * 2)
      pen.fillStyle = person.hair
      pen.fill()
      const look = pose === 'walk' ? (mirror ? -1.6 : 1.6) : 0
      disc(bob - 2.6 + look, headY + 0.8, 0.95, 1.1, '#1b1b1b')
      disc(bob + 2.6 + look, headY + 0.8, 0.95, 1.1, '#1b1b1b')
      if (activity === 'idle' && !still && Math.floor(t * 0.7) % 4 === 0) {
        pen.strokeStyle = '#1b1b1b'; pen.lineWidth = 0.7
        pen.beginPath(); pen.arc(bob + look * 0.5, headY + 3, 1.6, 0.2, Math.PI - 0.2); pen.stroke()
      }
    } else {
      disc(bob, headY - 0.4, 7.2, 7, person.hair)
    }
    if (person.kind === 'helper') {
      // Helpers wear a cap in their session's colour.
      pen.beginPath()
      pen.ellipse(bob, headY - 2.2, 7.6, 5.4, 0, Math.PI, Math.PI * 2)
      pen.fillStyle = colors.accent
      pen.fill()
      block(bob + (facing === 'front' ? -6 : -2), headY - 3, 8, 2, 1, shade(colors.accent, 0.2))
    } else {
      drawHeadwear(person, facing, headY, bob)
    }
    if (pose === 'stool') {
      // A laptop on the knees.
      block(-6, hipY - 1, 12, 2, 1, colors.metal[1])
      if (facing === 'back') block(-5, hipY - 8, 10, 7, 1, mix(colors.accent, '#ffffff', 0.25))
    }
  }
  function drawRobot(person, facing, pose) {
    const t = clockSeconds + person.phase
    const still = isReduced()
    const [light, mid, deep] = colors.robot
    disc(0, 0, 9, 3.6, colors.shadow)
    const step = pose === 'walk' && !still ? Math.sin(t * 11) * 2 : 0
    block(-5, -12 + Math.max(0, step), 4, 12, 1, deep)
    block(1, -12 + Math.max(0, -step), 4, 12, 1, deep)
    block(-8, -28, 16, 16, 3, mid)
    const working = person.activity !== 'idle' && person.activity !== 'waiting'
    const reach = working && !still ? Math.sin(t * 16) * 1.5 : 0
    block(-11, -26 + reach, 3, 11, 1.5, deep)
    block(8, -26 - reach, 3, 11, 1.5, deep)
    block(-7, -41, 14, 12, 3, light)
    pen.strokeStyle = deep; pen.lineWidth = 1
    pen.beginPath(); pen.moveTo(0, -41); pen.lineTo(0, -46); pen.stroke()
    const tip = person.activity === 'waiting' ? colors.warning : working ? '#3fb950' : colors.muted
    disc(0, -47, 1.8, 1.8, still || !working || Math.sin(t * 6) > 0 ? tip : deep)
    if (facing === 'front') {
      block(-5, -38, 10, 5, 2, '#1b1d21')
      disc(-2.2, -35.5, 1.1, 1.1, colors.accent)
      disc(2.2, -35.5, 1.1, 1.1, colors.accent)
    } else {
      block(-4, -24, 8, 6, 1, deep)
    }
  }
  function drawPerson(person) {
    const base = toScreen(person.gx, person.gy, person.elevation || 0)
    const walking = person.path.length > 0
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
    if (person.key === hoveredKey) {
      pen.strokeStyle = colors.accent; pen.lineWidth = 1.6
      pen.beginPath(); pen.ellipse(0, 0, 13 * person.size, 5.5 * person.size, 0, 0, Math.PI * 2); pen.stroke()
    }
    pen.scale(person.size * (mirror ? -1 : 1), person.size)
    if (person.kind === 'robot') drawRobot(person, facing, pose)
    else drawHuman(person, facing, pose, mirror)
    pen.restore()
    const headTop = base.y - (pose === 'walk' || pose === 'stand' || pose === 'pong' ? 50 : 47) * person.size
    hitBoxes.push({ key: person.key, x: base.x - 12 * person.size, y: headTop, width: 24 * person.size, height: base.y - headTop + 4 })
    person.headX = base.x
    person.headY = headTop
  }

  // ------------------------------------------------------------- effects --
  // Parcels for commits and paper planes for pushes, flying in world space.
  function launch(kind, from) {
    if (isReduced() || !isActive || document.visibilityState !== 'visible') { if (kind === 'parcel') outboxCount++; return }
    const start = clockSeconds
    if (kind === 'parcel') {
      const to = { gx: layout.printer.gx + 0.4, gy: layout.printer.gy + 0.3, height: 32 }
      effects.push({ kind, from: { ...from, height: 34 }, to, start, duration: 1.4 + Math.hypot(to.gx - from.gx, to.gy - from.gy) * 0.06 })
    } else {
      const windows = layout.backWindows.length ? layout.backWindows : [[layout.deskStartX, layout.deskStartX + 1.6]]
      const [windowFrom, windowTo] = windows.reduce((best, item) => (Math.abs((item[0] + item[1]) / 2 - from.gx) < Math.abs((best[0] + best[1]) / 2 - from.gx) ? item : best))
      effects.push({ kind, from: { ...from, height: 40 }, to: { gx: (windowFrom + windowTo) / 2, gy: 0.05, height: 54 }, start, duration: 2.2 })
    }
  }
  function drawEffects() {
    effects = effects.filter(effect => {
      const progress = (clockSeconds - effect.start) / effect.duration
      if (progress >= 1) { if (effect.kind === 'parcel') outboxCount++; return false }
      const eased = effect.kind === 'plane' ? progress * progress * (3 - 2 * progress) : progress
      const gx = effect.from.gx + (effect.to.gx - effect.from.gx) * eased
      const gy = effect.from.gy + (effect.to.gy - effect.from.gy) * eased
      const lift = Math.sin(progress * Math.PI) * (effect.kind === 'parcel' ? 46 : 30)
      const height = effect.from.height + (effect.to.height - effect.from.height) * eased + lift
      const point = toScreen(gx, gy, height)
      pen.save()
      pen.translate(point.x, point.y)
      if (effect.kind === 'parcel') {
        pen.rotate(Math.sin(progress * Math.PI * 2) * 0.3)
        block(-4.5, -4, 9, 8, 1, '#d2a46c')
        pen.fillStyle = '#a77a45'; pen.fillRect(-0.7, -4, 1.4, 8)
      } else {
        const ahead = toScreen(effect.from.gx + (effect.to.gx - effect.from.gx) * Math.min(1, eased + 0.02), effect.from.gy + (effect.to.gy - effect.from.gy) * Math.min(1, eased + 0.02), height)
        pen.rotate(Math.atan2(ahead.y - point.y, ahead.x - point.x))
        pen.globalAlpha = progress > 0.85 ? (1 - progress) / 0.15 : 1
        polygon([{ x: 7, y: 0 }, { x: -6, y: -4.5 }, { x: -3, y: 0 }], '#ffffff', 'rgba(0,0,0,.25)')
        polygon([{ x: 7, y: 0 }, { x: -6, y: 3.5 }, { x: -3, y: 0 }], '#e7e7e7', 'rgba(0,0,0,.25)')
      }
      pen.restore()
      return true
    })
  }

  // ------------------------------------------------------------ lighting --
  // At night the room darkens except where lamps and screens shine.
  function roomOutline() {
    const { floorWidth, floorDepth } = layout
    return [toScreen(0, floorDepth, -8), toScreen(0, floorDepth, WALL_HEIGHT), toScreen(0, 0, WALL_HEIGHT), toScreen(floorWidth, 0, WALL_HEIGHT), toScreen(floorWidth, 0, -8), toScreen(floorWidth, floorDepth, -8)]
  }
  function applyLighting() {
    const darkness = Math.min(0.72, nightness * (colors.isDark ? 0.4 : 0.34) + dimming)
    if (darkness < 0.02) return
    const width = Math.max(1, Math.round(canvas.width / 2)), height = Math.max(1, Math.round(canvas.height / 2))
    if (lightCanvas.width !== width || lightCanvas.height !== height) { lightCanvas.width = width; lightCanvas.height = height }
    lightPen.setTransform(1, 0, 0, 1, 0, 0)
    lightPen.globalCompositeOperation = 'source-over'
    lightPen.clearRect(0, 0, width, height)
    worldTransform(lightPen, 0.5)
    lightPen.beginPath()
    roomOutline().forEach((point, index) => (index ? lightPen.lineTo(point.x, point.y) : lightPen.moveTo(point.x, point.y)))
    lightPen.closePath()
    lightPen.fillStyle = `rgba(6,10,28,${darkness})`
    lightPen.fill()
    lightPen.globalCompositeOperation = 'destination-out'
    const lightStrength = Math.min(1, nightness + 0.2) * (1 - Math.min(0.5, dimming))
    for (const light of lights) {
      const gradient = lightPen.createRadialGradient(light.x, light.y, 1, light.x, light.y, light.radius)
      gradient.addColorStop(0, `rgba(0,0,0,${light.strength * lightStrength})`)
      gradient.addColorStop(1, 'rgba(0,0,0,0)')
      lightPen.fillStyle = gradient
      lightPen.fillRect(light.x - light.radius, light.y - light.radius, light.radius * 2, light.radius * 2)
    }
    pen.save()
    pen.setTransform(1, 0, 0, 1, 0, 0)
    pen.drawImage(lightCanvas, 0, 0, canvas.width, canvas.height)
    pen.restore()
    if (nightness > 0.3) {
      // Warm light pooling under lamps.
      pen.save()
      pen.globalCompositeOperation = 'lighter'
      for (const light of lights) if (light.warm) glow(light.x, light.y, light.radius * 0.8, '#ff9d4d', 0.07 * nightness)
      pen.restore()
    }
  }

  // ------------------------------------------------------------ overlays --
  function drawOverlays() {
    const hovered = people.get(hoveredKey)
    if (hovered) {
      // Who belongs to whom: lines from a session to its helpers, its child sessions and its parent.
      const family = [...people.values()].filter(person => person !== hovered && !person.leaving && (
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
    if (showNames) {
      pen.font = '700 10px -apple-system, system-ui, sans-serif'
      for (const segment of layout.segments) {
        if (!segment.isFirst) continue
        const anchor = toScreen(segment.x0 - 0.85, segment.gy + 1.4)
        const text = truncate(segment.label, 22) + (segment.count > 1 ? ` · ${segment.count}` : '')
        const width = pen.measureText(text).width + 22
        const box = { x: anchor.x - 4, y: anchor.y + 2, width, height: 16 }
        placed.push(box)
        block(box.x, box.y, width, 16, 4, colors.label)
        pen.strokeStyle = segment.color; pen.lineWidth = 1.2
        pen.beginPath(); pen.roundRect(box.x, box.y, width, 16, 4); pen.stroke()
        disc(box.x + 9, box.y + 8, 3.5, 3.5, segment.color)
        pen.fillStyle = colors.text; pen.textAlign = 'left'
        pen.fillText(text, box.x + 16, box.y + 11.5)
        pen.textAlign = 'center'
      }
    }
    const ordered = [...people.values()].filter(person => person.headX != null && person.alpha >= 0.3)
      .sort((first, second) => rank(first) - rank(second))
    function rank(person) { return person.key === hoveredKey ? 0 : person.activity === 'waiting' ? 1 : person.kind === 'helper' ? 3 : 2 }
    for (const person of ordered) {
      const pulse = isReduced() ? 1 : 1 + Math.sin(clockSeconds * (person.isUrgent ? 9 : 5) + person.phase) * (person.isUrgent ? 0.16 : 0.08)
      let labelY = person.headY - 4
      if (person.activity === 'waiting' && !person.leaving) {
        const bubbleY = person.headY - 11
        disc(person.headX, bubbleY, 8 * pulse, 8 * pulse, colors.critical)
        polygon([{ x: person.headX - 3, y: bubbleY + 6 }, { x: person.headX + 3, y: bubbleY + 6 }, { x: person.headX, y: bubbleY + 11 }], colors.critical)
        pen.fillStyle = '#ffffff'; pen.font = '800 11px -apple-system, system-ui, sans-serif'
        pen.fillText('!', person.headX, bubbleY + 4)
        labelY = bubbleY - 11
        placed.push({ x: person.headX - 9, y: bubbleY - 9, width: 18, height: 20 })
      } else if (person.activity === 'thinking' && person.kind !== 'helper' && !person.path.length) {
        const bubbleY = person.headY - 8
        block(person.headX + 2, bubbleY - 6, 16, 9, 4.5, colors.label)
        pen.fillStyle = colors.muted; pen.font = '700 9px -apple-system, system-ui, sans-serif'
        pen.fillText('…', person.headX + 10, bubbleY + 1)
      } else if (person.activity === 'idle' && person.target?.pose !== 'sofa' && !person.path.length && !person.errand && !isReduced()) {
        // Chat in the lounge: neighbours take turns.
        const neighbour = ordered.some(other => other !== person && other.activity === 'idle' && Math.hypot(other.gx - person.gx, other.gy - person.gy) < 1.7)
        if (neighbour && Math.floor((clockSeconds + person.phase * 3) / 2.5) % 3 === 0) {
          const bubbleY = person.headY - 9
          block(person.headX + 3, bubbleY - 7, 18, 10, 5, colors.label)
          polygon([{ x: person.headX + 5, y: bubbleY + 2 }, { x: person.headX + 9, y: bubbleY + 2 }, { x: person.headX + 4, y: bubbleY + 6 }], colors.label)
          pen.fillStyle = colors.muted; pen.font = '700 9px -apple-system, system-ui, sans-serif'
          pen.fillText('···', person.headX + 12, bubbleY + 0.5)
        }
      }
      // With Names off nothing is named but the one under the pointer, so snapshots stay private.
      const wantsName = person.key === hoveredKey || (showNames && (person.activity === 'waiting' || person.kind !== 'helper'))
      if (!wantsName || !person.label) continue
      pen.font = '600 10px -apple-system, system-ui, sans-serif'
      const text = truncate(person.label, person.key === hoveredKey ? 48 : 18)
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
      pen.globalAlpha = person.alpha * (person.key === hoveredKey ? 1 : 0.92)
      if (Math.abs(box.y - (labelY - 13)) > 1) {
        pen.strokeStyle = colors.border; pen.lineWidth = 0.8
        pen.beginPath(); pen.moveTo(person.headX, person.headY - 2); pen.lineTo(person.headX, box.y + (box.y < labelY - 13 ? 14 : 0)); pen.stroke()
      }
      block(box.x, box.y, width, 14, 7, colors.label)
      pen.strokeStyle = person.activity === 'waiting' ? colors.critical : colors.border
      pen.lineWidth = 0.8
      pen.beginPath(); pen.roundRect(box.x, box.y, width, 14, 7); pen.stroke()
      pen.fillStyle = colors.text
      pen.fillText(text, person.headX, box.y + 10.5)
      pen.globalAlpha = 1
    }
  }
  function drawVignette() {
    // Someone has waited a while: the edges of the office pulse red.
    const urgent = [...people.values()].some(person => person.isUrgent && !person.leaving)
    if (!urgent) return
    const strength = isReduced() ? 0.16 : 0.12 + 0.1 * (Math.sin(clockSeconds * 3) + 1) / 2
    const outline = roomOutline()
    const xs = outline.map(point => point.x), ys = outline.map(point => point.y)
    const centerX = (Math.min(...xs) + Math.max(...xs)) / 2, centerY = (Math.min(...ys) + Math.max(...ys)) / 2
    const reach = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2
    pen.save()
    pen.beginPath()
    outline.forEach((point, index) => (index ? pen.lineTo(point.x, point.y) : pen.moveTo(point.x, point.y)))
    pen.closePath()
    pen.clip()
    const gradient = pen.createRadialGradient(centerX, centerY, reach * 0.45, centerX, centerY, reach * 1.05)
    gradient.addColorStop(0, alpha(colors.critical, 0))
    gradient.addColorStop(1, alpha(colors.critical, strength * (colors.isDark ? 1.6 : 1.1)))
    pen.fillStyle = gradient
    pen.fillRect(centerX - reach * 1.1, centerY - reach * 1.1, reach * 2.2, reach * 2.2)
    pen.restore()
  }

  // --------------------------------------------------------------- frame --
  function draw(fit = fitView) {
    if (!colors) refreshColors()
    if (!fit()) return
    nightness = nightnessNow()
    renderFloor()
    pen = mainPen
    pen.setTransform(1, 0, 0, 1, 0, 0)
    pen.clearRect(0, 0, canvas.width, canvas.height)
    pen.drawImage(floorCache, 0, 0)
    worldTransform(pen)
    hitBoxes = []
    lights = []
    drawWindows()
    drawClock()
    drawWhiteboard()
    drawPoster()
    const ownerOfDesk = new Map(), robotOfRack = new Map()
    for (const person of people.values()) {
      if (person.kind === 'session' && person.desk) ownerOfDesk.set(person.sessionId, person)
      if (person.kind === 'robot' && rackOf.has(person.sessionId)) robotOfRack.set(rackOf.get(person.sessionId), person)
    }
    const { utilityX, corridorY, floorWidth } = layout
    const scene = []
    scene.push({ depth: 1.2, paint: drawLounge })
    scene.push({ depth: 0.35 + 4.2, paint: () => drawWaterCooler(0.35, 4.2) })
    scene.push({ depth: 4.4 + 2.05, paint: () => drawFloorLamp(4.4, 2.05) })
    scene.push({ depth: 1.55 + 3.42 + 1.2, paint: drawPingPong })
    scene.push({ depth: 5.0 + 0.5, paint: () => drawTallPlant(5.0, 0.5) })
    scene.push({ depth: 0.45 + corridorY - 1.1, paint: () => drawPlant(0.45, corridorY - 1.1, 0.9) })
    scene.push({ depth: floorWidth - 0.45 + corridorY - 0.3, paint: () => drawTallPlant(floorWidth - 0.45, corridorY - 0.3) })
    scene.push({ depth: utilityX + 0.1 + 0.48, paint: drawBookshelf })
    scene.push({ depth: layout.globe.gx + layout.globe.gy, paint: drawGlobe })
    scene.push({ depth: layout.printer.gx + layout.printer.gy + 0.9, paint: drawPrinter })
    scene.push({ depth: layout.shredder.gx + layout.shredder.gy + 0.6, paint: drawShredder })
    for (const [sessionId, desk] of layout.deskBySession) {
      const owner = ownerOfDesk.get(sessionId)
      scene.push({ depth: desk.gx + desk.gy + 0.36, paint: () => drawDesk(desk, owner) })
      scene.push({ depth: desk.gx + desk.gy + 0.9, paint: () => drawChair(desk, 'seat') })
      scene.push({ depth: desk.gx + desk.gy + 1.12, paint: () => drawChair(desk, 'back') })
    }
    layout.racks.forEach((rack, index) => scene.push({ depth: rack.gx + rack.gy + 0.3, paint: () => drawRack(rack, robotOfRack.get(index)) }))
    for (const person of people.values()) {
      const seated = !person.path.length && person.target.pose === 'sit'
      scene.push({ depth: person.gx + person.gy + (seated ? 0.01 : 0.05), paint: () => drawPerson(person) })
    }
    scene.sort((first, second) => first.depth - second.depth)
    for (const item of scene) item.paint()
    drawEffects()
    applyLighting()
    worldTransform(pen)
    drawVignette()
    drawOverlays()
  }
  function step(seconds) {
    clockSeconds += seconds
    const now = Date.now()
    if (cameraReturnAt && now > cameraReturnAt) { cameraReturnAt = 0; cameraGoal = { zoom: 1, x: 0, y: 0 } }
    const ease = Math.min(1, seconds * 3.5)
    camera = { zoom: camera.zoom + (cameraGoal.zoom - camera.zoom) * ease, x: camera.x + (cameraGoal.x - camera.x) * ease, y: camera.y + (cameraGoal.y - camera.y) * ease }
    for (const person of [...people.values()]) {
      if (person.path.length) {
        const next = person.path[0]
        const deltaX = next.gx - person.gx, deltaY = next.gy - person.gy
        const distance = Math.hypot(deltaX, deltaY)
        const stride = WALK_SPEED * seconds * (person.kind === 'helper' ? 1.15 : 1)
        if (distance <= stride) { person.gx = next.gx; person.gy = next.gy; person.path.shift() } else { person.gx += (deltaX / distance) * stride; person.gy += (deltaY / distance) * stride }
      }
      if (person.leaving) {
        if (!person.path.length) person.alpha -= seconds * 3
        if (person.alpha <= 0) removePerson(person)
        continue
      }
      if (person.alpha < 1) person.alpha = Math.min(1, person.alpha + seconds * 2.5)
      runErrand(person, now)
      maybeStartErrand(person, seconds)
    }
  }
  function frame(now) {
    frameId = 0
    const seconds = lastFrameAt ? Math.min(0.06, (now - lastFrameAt) / 1000) : 0
    lastFrameAt = now
    step(seconds)
    draw()
    if (shouldAnimate()) frameId = requestAnimationFrame(frame)
    else lastFrameAt = 0
  }
  const shouldAnimate = () => isActive && document.visibilityState === 'visible' && !isReduced()
  function wake() {
    if (!isActive || document.visibilityState !== 'visible') return
    if (isReduced()) { settleAll(); draw(); return }
    if (!frameId) frameId = requestAnimationFrame(frame)
  }
  function settleAll() {
    // Without motion everyone is simply where they belong.
    for (const person of [...people.values()]) {
      if (person.leaving) { removePerson(person); continue }
      person.errand = null
      person.carrying = ''
      if (person.path.length) { const last = person.path[person.path.length - 1]; person.gx = last.gx; person.gy = last.gy; person.path = [] }
      person.alpha = 1
    }
    effects = []
    camera = { ...cameraGoal }
  }
  function removePerson(person) {
    people.delete(person.key)
    if (person.kind === 'robot' && !liveIds.has(person.sessionId)) rackOf.delete(person.sessionId)
  }

  // ------------------------------------------------------------- errands --
  // Short trips away from where someone belongs: coffee, a book from the
  // shelf, or the shredder after a compaction. Only while things move.
  function startErrand(person, kind, spots, stayMs) {
    const taken = new Set([...people.values()].filter(other => other !== person && other.errand).map(other => other.errand.key))
    const spot = spots.find(candidate => !taken.has(candidate))
    if (!spot) return false
    person.errand = { kind, spot: { ...spot, pose: 'stand', facing: 'back', zone: spotZone(spot) }, stayMs, phase: 'going', key: spot }
    person.carrying = kind === 'shred' ? 'pile' : kind === 'coffee' && person.activity === 'idle' ? 'mug' : ''
    retarget(person)
    return true
  }
  function runErrand(person, now) {
    const errand = person.errand
    if (!errand) return
    if (errand.phase === 'going' && !person.path.length) { errand.phase = 'staying'; errand.until = now + errand.stayMs }
    else if (errand.phase === 'staying' && now > errand.until) {
      errand.phase = 'returning'
      person.carrying = errand.kind === 'fetch' ? 'paper' : errand.kind === 'coffee' ? 'mug' : ''
      retarget(person)
    } else if (errand.phase === 'returning' && !person.path.length) {
      person.errand = null
      person.carrying = ''
    }
  }
  function maybeStartErrand(person, seconds) {
    if (person.errand || person.path.length || person.leaving || isReduced() || !seconds) return
    if (person.kind === 'session' && person.activity === 'idle' && person.target?.pose === 'stand' && Math.random() < seconds / 40) {
      startErrand(person, 'coffee', layout.coffeeSpots, 2600)
    } else if (person.kind === 'helper' && Math.random() < seconds / 16) {
      startErrand(person, 'fetch', layout.shelfSpots, 1500)
    }
  }
  function spotZone(spot) {
    if (spot.gx < LOUNGE_WIDTH) return 'lounge'
    if (spot.gx >= layout.utilityX - 0.3) return 'utility'
    return 'open'
  }

  // ------------------------------------------------------------- walking --
  function exitX(point, zone) {
    if (zone === 'desk') return point.gx + 1.2
    if (zone === 'rack' || zone === 'utility') return layout.utilityX - 0.25
    if (zone === 'lounge') return LOUNGE_WIDTH - 0.3
    return point.gx
  }
  function route(person, destination) {
    const from = { gx: person.gx, gy: person.gy }
    if (Math.hypot(destination.gx - from.gx, destination.gy - from.gy) < 1.6) return [destination]
    const corridor = layout.corridorY
    const fromAisle = exitX(from, person.zone), toAisle = exitX(destination, destination.zone)
    // Along one aisle there is no need to go round by the corridor.
    const waypoints = Math.abs(fromAisle - toAisle) < 0.05
      ? [{ gx: fromAisle, gy: from.gy }, { gx: toAisle, gy: destination.gy }, destination]
      : [{ gx: fromAisle, gy: from.gy }, { gx: fromAisle, gy: corridor }, { gx: toAisle, gy: corridor }, { gx: toAisle, gy: destination.gy }, destination]
    return waypoints.filter((point, index) => {
      const previousPoint = index ? waypoints[index - 1] : from
      return Math.hypot(point.gx - previousPoint.gx, point.gy - previousPoint.gy) > 0.02
    })
  }
  function walkTo(person, target) {
    const moved = !person.target || Math.hypot(person.target.gx - target.gx, person.target.gy - target.gy) > 0.02
    if (moved) {
      if (isReduced() || !hasSynced) { person.gx = target.gx; person.gy = target.gy; person.path = [] }
      else person.path = route(person, target)
    }
    person.target = target
    person.zone = target.zone
  }
  function placeOf(person) {
    if (person.errand && person.errand.phase !== 'returning') return person.errand.spot
    if (person.trip) return person.trip.spot
    return person.home
  }
  function retarget(person) {
    const place = placeOf(person)
    if (place) walkTo(person, place)
  }
  function leave(person) {
    if (person.leaving) return
    person.leaving = true
    person.errand = null
    person.trip = null
    person.carrying = ''
    person.activity = 'leaving'
    const door = { ...layout.door, zone: 'open' }
    person.path = route(person, door)
    person.path.push({ ...layout.outside })
    person.target = { ...person.target, facing: 'front', pose: 'stand' }
  }
  function createPerson(key, kind, seed, start) {
    const hash = hashOf(seed)
    const person = {
      key, kind,
      phase: (hash % 1000) / 160,
      shirt: colors.shirts[hash % colors.shirts.length],
      skin: SKIN_TONES[(hash >> 5) % SKIN_TONES.length],
      hair: HAIR_COLORS[(hash >> 9) % HAIR_COLORS.length],
      size: kind === 'helper' ? 0.68 : 1,
      gx: start.gx, gy: start.gy, path: [], alpha: hasSynced && !isReduced() ? 0 : 1,
      zone: start.zone || 'open', target: null, leaving: false, activity: 'idle', errand: null, trip: null, carrying: '', outfit: '',
    }
    people.set(key, person)
    return person
  }

  // --------------------------------------------------------------- events --
  function addEvent(text, kind, sessionId) {
    events.unshift({ at: Date.now(), text, kind, sessionId })
    events.length = Math.min(events.length, 40)
  }
  function renderTicker() {
    const holder = $('#office-ticker')
    if (!holder) return
    const recent = events.slice(0, isWallMode() ? 12 : 6)
    if (!recent.length) { holder.innerHTML = '<span class="ticker-empty">Things that happen in the office show up here: someone needing you, commits, pushes, compactions, people coming and going.</span>'; return }
    const items = recent.map(event => `<span class="ticker-item kind-${event.kind}"><b>${escapeHtml(event.text)}</b> <i>${escapeHtml(ago(event.at))}</i></span>`).join('')
    holder.innerHTML = isWallMode() && !isReduced() ? `<span class="ticker-track">${items}${items}</span>` : items
  }
  function escapeHtml(text) { return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])) }
  function chime() {
    if (!soundOn) return
    try {
      audio = audio || new AudioContext()
      const start = audio.currentTime
      ;[660, 880].forEach((frequency, index) => {
        const oscillator = audio.createOscillator(), gain = audio.createGain()
        const at = start + index * 0.16
        oscillator.type = 'sine'
        oscillator.frequency.value = frequency
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5)
        oscillator.connect(gain).connect(audio.destination)
        oscillator.start(at)
        oscillator.stop(at + 0.55)
      })
    } catch {}
  }
  function focusOn(person) {
    // In wall mode the camera moves in on whoever needs you, then eases back.
    if (!isWallMode() || isReduced() || !person) return
    const point = toScreen(person.gx, person.gy, 26)
    cameraGoal = clampCamera({ zoom: 1.8, x: point.x - view.baseCenterX, y: point.y - view.baseCenterY })
    cameraReturnAt = Date.now() + 6000
    wake()
  }

  // ---------------------------------------------------------------- sync --
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
  function noticeChanges(session, person) {
    const before = previous.get(session.sessionId)
    const now = { status: session.status, commits: session.commits || 0, pushes: session.pushes || 0, contextTokens: session.contextTokens || 0, helpers: new Set(session.subagents.filter(agent => agent.isRunning).map(agent => agent.agentId)), shells: new Map((session.shells || []).map(shell => [shell.id, shell])) }
    previous.set(session.sessionId, now)
    if (!before) { if (hasSynced) addEvent(`${session.name} came in`, 'join', session.sessionId); return }
    const desk = layout.deskBySession.get(session.sessionId)
    const from = desk ? { gx: desk.gx, gy: desk.gy - 0.1 } : { gx: person.gx, gy: person.gy }
    if (now.status === 'waiting' && before.status !== 'waiting') { addEvent(`${session.name} needs you`, 'waiting', session.sessionId); chime(); setTimeout(() => focusOn(people.get(session.sessionId)), 1200) }
    if (before.status === 'busy' && now.status === 'idle') addEvent(`${session.name} finished`, 'done', session.sessionId)
    if (now.commits > before.commits) { addEvent(`${session.name} committed${session.branch ? ' on ' + session.branch : ''}`, 'commit', session.sessionId); launch('parcel', from) }
    if (now.pushes > before.pushes) { addEvent(`${session.name} pushed${session.branch ? ' ' + session.branch : ''}`, 'push', session.sessionId); launch('plane', from) }
    if (before.contextTokens > 40_000 && now.contextTokens < before.contextTokens * 0.6 && before.contextTokens - now.contextTokens > 30_000) {
      addEvent(`${session.name} compacted its context`, 'compact', session.sessionId)
      if (person && person.kind === 'session' && now.status !== 'waiting' && !isReduced()) startErrand(person, 'shred', layout.shredSpots, 2600)
    }
    for (const [shellId, shell] of now.shells) {
      if (!before.shells?.has(shellId)) addEvent(`${session.name} started a background shell${shell.description || shell.command ? ': ' + truncate(shell.description || shell.command, 40) : ''}`, 'shell', session.sessionId)
    }
    for (const [shellId, shell] of before.shells || []) {
      if (!now.shells.has(shellId)) addEvent(`${session.name}: background shell finished${shell.description ? ' (' + truncate(shell.description, 36) + ')' : ''}`, 'shell', session.sessionId)
    }
    for (const agentId of now.helpers) {
      if (before.helpers.has(agentId)) continue
      const agent = session.subagents.find(item => item.agentId === agentId)
      addEvent(`${session.name} called a helper${agent?.description ? ': ' + truncate(agent.description, 40) : ''}`, 'helper', session.sessionId)
    }
  }
  function sync(live) {
    if (!colors) refreshColors()
    const sessions = live?.sessions || []
    planLimits = (live?.rateLimits || []).filter(limit => typeof limit.percentUsed === 'number')
    const highest = Math.max(0, ...planLimits.map(limit => limit.percentUsed))
    dimming = highest >= 95 ? 0.26 : highest >= 85 ? 0.13 : 0
    liveIds = new Set(sessions.map(session => session.sessionId))
    const { byId, belowOf } = sessionTree(sessions)
    const isRobot = session => !session.tty && !session.hidden
    // Projects in the order they first appeared, members likewise.
    const groupsByKey = new Map()
    for (const session of sessions) {
      if (!memberOrder.has(session.sessionId)) memberOrder.set(session.sessionId, orderCounter++)
      if (isRobot(session)) {
        if (!rackOf.has(session.sessionId)) rackOf.set(session.sessionId, firstFree(rackOf))
        continue
      }
      rackOf.delete(session.sessionId)
      const key = folderOf(session)
      if (!groupOrder.has(key)) groupOrder.set(key, orderCounter++)
      if (!groupsByKey.has(key)) groupsByKey.set(key, { key, label: session.folder || key.split('/').pop() || key, color: colors.shirts[hashOf(key) % colors.shirts.length], members: [] })
      groupsByKey.get(key).members.push(session.sessionId)
    }
    // People still walking out keep their desk until they are gone.
    for (const person of people.values()) {
      if (person.kind !== 'session' || !person.leaving || liveIds.has(person.sessionId) || !person.groupKey) continue
      if (!groupsByKey.has(person.groupKey)) groupsByKey.set(person.groupKey, { key: person.groupKey, label: person.groupLabel, color: colors.shirts[hashOf(person.groupKey) % colors.shirts.length], members: [] })
      groupsByKey.get(person.groupKey).members.push(person.sessionId)
      if (!memberOrder.has(person.sessionId)) memberOrder.set(person.sessionId, orderCounter++)
    }
    for (const key of [...groupOrder.keys()]) if (!groupsByKey.has(key)) groupOrder.delete(key)
    const groups = [...groupsByKey.values()].sort((first, second) => groupOrder.get(first.key) - groupOrder.get(second.key))
    for (const group of groups) group.members.sort((first, second) => memberOrder.get(first) - memberOrder.get(second))
    const nextLayout = buildLayout(groups, Math.max(-1, ...rackOf.values()) + 1)
    const layoutChanged = nextLayout.key !== layout.key || !hasSynced
    if (layoutChanged) layout = nextLayout
    else layout.deskBySession = nextLayout.deskBySession
    // Lounge spots for the idle, kept while they stay idle.
    const activities = new Map(sessions.map(session => [session.sessionId, activityOf(session, belowOf.get(session.sessionId))]))
    for (const [sessionId] of loungeOf) if (activities.get(sessionId) !== 'idle' || isRobot(byId.get(sessionId) || {})) loungeOf.delete(sessionId)
    for (const session of sessions) {
      const key = session.sessionId
      if (!isRobot(session) && activities.get(key) === 'idle' && !loungeOf.has(key) && loungeOf.size < layout.lounge.length) loungeOf.set(key, firstFree(loungeOf))
    }
    pairUpPingPong()
    // Trips for long commands and web searches, kept a little while so nobody paces back and forth.
    const now = Date.now()
    for (const [sessionId, trip] of tripOf) {
      const session = byId.get(sessionId)
      const wanted = session ? tripWanted(session, activities.get(sessionId)) : ''
      if (!session || (wanted !== trip.kind && now - trip.since > TRIP_MIN_MS)) { tripOf.delete(sessionId); const person = people.get(sessionId); if (person) person.tripCooldownUntil = now + TRIP_COOLDOWN_MS }
    }
    for (const session of sessions) {
      if (isRobot(session) || tripOf.has(session.sessionId)) continue
      const kind = tripWanted(session, activities.get(session.sessionId))
      const person = people.get(session.sessionId)
      if (!kind || (person && person.tripCooldownUntil > now)) continue
      const spots = kind === 'globe' ? layout.globeSpots : layout.watchSpots
      const used = new Set([...tripOf.values()].filter(trip => trip.kind === kind).map(trip => trip.slot))
      const slot = spots.findIndex((spot, index) => !used.has(index))
      if (slot >= 0) tripOf.set(session.sessionId, { kind, slot, since: now })
    }
    const wanted = new Set()
    let countAtDesks = 0, countLounge = 0, countHelpers = 0, countRobots = 0, countTrips = 0
    today = { commits: 0, pushes: 0, prompts: 0, working: 0 }
    for (const session of sessions) {
      const key = session.sessionId
      wanted.add(key)
      const robot = isRobot(session)
      let activity = activities.get(key)
      today.commits += session.commits || 0
      today.pushes += session.pushes || 0
      today.prompts += session.prompts || 0
      if (session.status === 'busy') today.working++
      let home
      if (robot) {
        countRobots++
        const rack = layout.racks[rackOf.get(key)] || layout.racks[0]
        home = { gx: rack.gx, gy: rack.gy + 0.95, pose: 'stand', facing: activity === 'waiting' ? 'front' : 'back', zone: 'rack' }
      } else {
        const desk = layout.deskBySession.get(key)
        if (activity === 'waiting') home = { gx: desk.gx + 0.85, gy: desk.gy + 1.0, pose: 'stand', facing: 'front', zone: 'desk' }
        else if (activity === 'supervising' && session.status !== 'busy') home = { gx: desk.gx - 0.05, gy: desk.gy + 1.5, pose: 'stand', facing: 'back', zone: 'desk' }
        else if (activity === 'idle' && loungeOf.has(key)) {
          const spot = layout.lounge[loungeOf.get(key)]
          home = { gx: spot.gx, gy: spot.gy, pose: spot.pose, facing: spot.facing, side: spot.side, zone: 'lounge' }
          countLounge++
        } else {
          if (activity === 'idle') activity = 'relaxing'
          home = { gx: desk.gx, gy: desk.gy + 0.88, pose: 'sit', facing: 'back', zone: 'desk' }
          if (activity !== 'relaxing') countAtDesks++
        }
      }
      let person = people.get(key)
      if (person && person.leaving) { person.leaving = false; person.alpha = Math.max(person.alpha, 0.4) }
      if (!person) {
        const start = hasSynced ? { ...layout.outside, zone: 'open' } : home
        person = createPerson(key, robot ? 'robot' : 'session', key, start)
      }
      person.kind = robot ? 'robot' : 'session'
      person.sessionId = key
      person.session = session
      person.label = session.name
      person.activity = activity
      person.outfit = robot ? '' : outfitOf(session.model)
      person.isAway = activity === 'idle' || activity === 'relaxing'
      person.parentKey = session.parentSessionId && byId.has(session.parentSessionId) ? session.parentSessionId : ''
      person.desk = robot ? null : layout.deskBySession.get(key)
      person.groupKey = robot ? '' : folderOf(session)
      person.groupLabel = session.folder || person.groupKey
      if (activity === 'waiting') {
        if (!waitingSince.has(key)) waitingSince.set(key, hasSynced ? now : Math.min(now, session.updatedAt || now))
      } else waitingSince.delete(key)
      person.isUrgent = activity === 'waiting' && now - (waitingSince.get(key) || now) > WAIT_ALERT_MS
      if (activity === 'waiting' && person.errand) { person.errand = null; person.carrying = '' }
      const trip = !robot && activity !== 'waiting' ? tripOf.get(key) : null
      if (trip) {
        const spot = (trip.kind === 'globe' ? layout.globeSpots : layout.watchSpots)[trip.slot]
        person.trip = { kind: trip.kind, spot: { ...spot, pose: 'stand', facing: 'back', zone: 'utility' } }
        countTrips++
      } else person.trip = null
      noticeChanges(session, person)
      person.home = home
      retarget(person)
      if (robot) continue
      // Running subagents sit on stools around their session's desk.
      const desk = layout.deskBySession.get(key)
      const stools = [[-1.0, 0.25], [1.05, 0.25], [-1.0, 1.0], [1.05, 1.0]]
      session.subagents.filter(agent => agent.isRunning).slice(0, stools.length).forEach((agent, index) => {
        countHelpers++
        const helperKey = key + ':' + agent.agentId
        wanted.add(helperKey)
        let helper = people.get(helperKey)
        if (!helper) helper = createPerson(helperKey, 'helper', helperKey, { gx: person.gx, gy: person.gy, zone: 'desk' })
        helper.shirt = person.shirt
        helper.sessionId = key
        helper.agent = agent
        helper.session = session
        helper.label = agent.description
        helper.activity = 'typing'
        helper.parentKey = key
        const [offsetX, offsetY] = stools[index]
        helper.home = { gx: desk.gx + offsetX, gy: desk.gy + offsetY, pose: 'stool', facing: 'back', zone: 'desk' }
        retarget(helper)
      })
    }
    for (const person of people.values()) {
      if (wanted.has(person.key)) continue
      if (person.kind !== 'helper' && !person.leaving && previous.has(person.sessionId)) { addEvent(`${person.label} left`, 'leave', person.sessionId); previous.delete(person.sessionId) }
      leave(person)
    }
    for (const sessionId of [...memberOrder.keys()]) if (!liveIds.has(sessionId) && !people.has(sessionId)) memberOrder.delete(sessionId)
    hasSynced = true
    const waiting = sessions.filter(session => session.status === 'waiting').length
    const summary = [
      `${countAtDesks} working at desks`, waiting ? `${waiting} waiting for you` : '', `${countLounge} in the lounge`,
      countTrips ? `${countTrips} away from their desk` : '',
      countHelpers ? `${countHelpers} helper${countHelpers > 1 ? 's' : ''} (subagents)` : '', countRobots ? `${countRobots} robot${countRobots > 1 ? 's' : ''} (headless sessions)` : '',
      groups.length ? `${groups.length} project${groups.length > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' · ')
    $('#office-hint').textContent = summary
    canvas.setAttribute('aria-label', 'Office view: ' + summary)
    $('#office-dim').hidden = !dimming
    $('#office-dim').textContent = dimming ? `Lights dimmed: a plan window is at ${Math.round(highest)}%` : ''
    renderTicker()
    if (isActive) (isReduced() ? draw() : wake())
  }
  // Ping-pong needs two: a lone player goes back to standing, and a second
  // idle person joins one who is waiting at the table.
  function pairUpPingPong() {
    const pongSlots = layout.lounge.map((spot, index) => (spot.pose === 'pong' ? index : -1)).filter(index => index >= 0)
    const holders = pongSlots.map(slot => [...loungeOf].find(([, index]) => index === slot)?.[0])
    if (holders.filter(Boolean).length !== 1) return
    const lonelySlot = pongSlots[holders[0] ? 1 : 0]
    const standing = [...loungeOf].find(([, index]) => layout.lounge[index]?.pose === 'stand')
    if (standing) { loungeOf.set(standing[0], lonelySlot); return }
    const loner = holders.find(Boolean)
    loungeOf.delete(loner)
    const free = layout.lounge.findIndex((spot, index) => spot.pose !== 'pong' && ![...loungeOf.values()].includes(index))
    if (free >= 0) loungeOf.set(loner, free)
  }

  // ---------------------------------------------------------- interaction --
  function hitAt(event) {
    const bounds = canvas.getBoundingClientRect()
    const worldX = (event.clientX - bounds.left - view.offsetX) / view.scale
    const worldY = (event.clientY - bounds.top - view.offsetY) / view.scale
    for (let index = hitBoxes.length - 1; index >= 0; index--) {
      const box = hitBoxes[index]
      if (worldX >= box.x && worldX <= box.x + box.width && worldY >= box.y && worldY <= box.y + box.height) return people.get(box.key)
    }
    return null
  }
  function describe(person) {
    const session = person.session
    if (!session) return person.label || ''
    if (person.kind === 'helper') {
      const agent = person.agent
      return `${agent.description}\n${agent.agentType || 'Subagent'} helping ${session.name}\nRunning for ${ago(agent.startedAt)}\nClick to open ${session.name}`
    }
    const statusLabel = STATUS[session.status]?.label || session.status
    const doing = person.trip ? TRIP_LABEL[person.trip.kind] : person.errand?.kind === 'shred' ? 'shredding its old context' : ACTIVITY_LABEL[person.activity] || person.activity
    const status = person.leaving ? 'Session ended' : person.activity === 'waiting' ? statusLabel + (person.isUrgent ? ` for ${ago(waitingSince.get(session.sessionId))}` : '') : `${statusLabel} · ${doing}`
    const helpers = session.subagents.filter(agent => agent.isRunning).length
    const shells = session.shells || []
    return [
      session.name,
      status,
      `${shortModel(session.model) || 'model unknown'}${person.outfit ? ' · ' + OUTFIT_LABEL[person.outfit] : ''} · context ${session.contextPercent}%`,
      session.folder + (session.branch ? ` · ${session.branch}` : ''),
      helpers ? `${helpers} helper${helpers > 1 ? 's' : ''} running` : '',
      shells.length ? `${shells.length} background shell${shells.length > 1 ? 's' : ''}: ${shells.slice(0, 3).map(shell => truncate(shell.description || shell.command, 34)).join(', ')}${shells.length > 3 ? '…' : ''}` : '',
      session.hidden ? `Hidden · ${session.jobId} · reached only from this page` : '',
      person.kind === 'robot' ? (sessionById(session.parentSessionId) ? `Headless, started by ${sessionById(session.parentSessionId).name}` : 'Headless session, no terminal tab') : '',
      person.leaving ? '' : session.tty ? 'Click for details · double-click for its tab' : 'Click for details',
    ].filter(Boolean).join('\n')
  }
  let drag = null
  let suppressClick = false
  canvas.addEventListener('mousedown', event => {
    if (event.button !== 0 || camera.zoom <= 1.01) return
    drag = { x: event.clientX, y: event.clientY, cameraX: camera.x, cameraY: camera.y, moved: false }
  })
  window.addEventListener('mouseup', () => { if (drag?.moved) suppressClick = true; drag = null; canvas.classList.remove('dragging') })
  canvas.addEventListener('mousemove', event => {
    if (drag) {
      const deltaX = event.clientX - drag.x, deltaY = event.clientY - drag.y
      if (!drag.moved && Math.hypot(deltaX, deltaY) > 4) { drag.moved = true; canvas.classList.add('dragging'); tip.style.display = 'none' }
      if (drag.moved) { cameraReturnAt = 0; setCamera({ zoom: camera.zoom, x: drag.cameraX - deltaX / view.scale, y: drag.cameraY - deltaY / view.scale }, true); return }
    }
    const person = hitAt(event)
    const key = person ? person.key : ''
    if (key !== hoveredKey) { hoveredKey = key; if (isReduced()) draw() }
    canvas.style.cursor = person && !person.leaving ? 'pointer' : camera.zoom > 1.01 ? 'grab' : 'default'
    if (!person) { tip.style.display = 'none'; return }
    tip.textContent = describe(person)
    tip.style.display = 'block'
    tip.style.left = Math.min(window.innerWidth - tip.offsetWidth - 8, event.clientX + 14) + 'px'
    tip.style.top = Math.min(window.innerHeight - tip.offsetHeight - 8, event.clientY + 16) + 'px'
  })
  canvas.addEventListener('mouseleave', () => { hoveredKey = ''; tip.style.display = 'none'; if (isReduced()) draw() })
  // Pinch on a trackpad, or ctrl and the wheel, zooms around the pointer.
  canvas.addEventListener('wheel', event => {
    if (!event.ctrlKey && !isWallMode()) return
    event.preventDefault()
    const bounds = canvas.getBoundingClientRect()
    zoomAround(camera.zoom * Math.exp(-event.deltaY * 0.01), event.clientX - bounds.left, event.clientY - bounds.top)
  }, { passive: false })
  function zoomAround(zoom, screenX, screenY) {
    cameraReturnAt = 0
    const worldX = (screenX - view.offsetX) / view.scale, worldY = (screenY - view.offsetY) / view.scale
    const nextZoom = Math.min(3, Math.max(1, zoom))
    const nextScale = view.baseScale * nextZoom
    setCamera({ zoom: nextZoom, x: (view.cssWidth / 2 - screenX) / nextScale + worldX - view.baseCenterX, y: (view.cssHeight / 2 - screenY) / nextScale + worldY - view.baseCenterY }, true)
  }
  let clickTimer = 0
  canvas.addEventListener('click', event => {
    if (suppressClick) { suppressClick = false; return }
    const person = hitAt(event)
    if (!person || person.leaving || !person.sessionId) return
    clearTimeout(clickTimer)
    clickTimer = setTimeout(() => openInList(person.sessionId), 260)
  })
  canvas.addEventListener('dblclick', event => {
    clearTimeout(clickTimer)
    const person = hitAt(event)
    if (!person || person.leaving || !person.sessionId) return
    const session = sessionById(person.sessionId)
    if (session?.tty) focusTab(session.sessionId)
    else openInList(person.sessionId)
  })
  function openInList(sessionId) {
    tip.style.display = 'none'
    if (isWallMode()) document.exitFullscreen().catch(() => {})
    state.open = new Set([sessionId])
    state.filter = 'all'
    let parent = sessionById(sessionId)?.parentSessionId
    for (let depth = 0; parent && depth < 6; depth++) { state.collapsed.delete(parent); parent = sessionById(parent)?.parentSessionId }
    setTab('sessions')
    renderLive()
    const row = document.querySelector(isListView() ? `.nav-item[data-id="${CSS.escape(sessionId)}"]` : `tr.session[data-id="${CSS.escape(sessionId)}"]`)
    if (row) { row.scrollIntoView({ block: 'center', behavior: isReduced() ? 'auto' : 'smooth' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600) }
  }

  // -------------------------------------------------------------- toolbar --
  const stamp = () => { const date = new Date(); const pad = value => String(value).padStart(2, '0'); return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}` }
  function download(blob, name) {
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(link.href), 4000)
  }
  function snapshot() {
    tip.style.display = 'none'
    hoveredKey = ''
    draw()
    canvas.toBlob(blob => { if (blob) { download(blob, `fleet-office-${stamp()}.png`); toast(showNames ? 'Snapshot saved. It shows session and project names; turn off Names first to leave them out.' : 'Snapshot saved without names.') } }, 'image/png')
  }
  let recorder = null
  function recordClip() {
    if (recorder) return
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(candidate => window.MediaRecorder?.isTypeSupported?.(candidate))
    if (!canvas.captureStream || !type) { toast('This browser cannot record the canvas. Try a snapshot instead.'); return }
    const button = $('#office-clip')
    const chunks = []
    recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 6_000_000 })
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
    recorder.onstop = () => {
      recorder = null
      button.textContent = 'Record clip'
      button.disabled = false
      download(new Blob(chunks, { type: 'video/webm' }), `fleet-office-${stamp()}.webm`)
      toast(showNames ? 'Clip saved. It shows session and project names; turn off Names first to leave them out.' : 'Clip saved without names.')
    }
    tip.style.display = 'none'
    hoveredKey = ''
    wake()
    recorder.start()
    button.disabled = true
    let left = 8
    button.textContent = `Recording ${left}s`
    const timer = setInterval(() => {
      left--
      if (left > 0) { button.textContent = `Recording ${left}s`; return }
      clearInterval(timer)
      recorder.stop()
    }, 1000)
  }
  function toggleWallMode() {
    if (isWallMode()) { document.exitFullscreen().catch(() => {}); return }
    if (!card.requestFullscreen) { toast('Full screen is not available in this browser.'); return }
    card.requestFullscreen().catch(error => toast('Full screen was refused: ' + error.message))
  }
  document.addEventListener('fullscreenchange', () => {
    const on = isWallMode()
    $('#office-wall').textContent = on ? 'Exit wall mode' : 'Wall mode'
    cameraGoal = { zoom: 1, x: 0, y: 0 }
    camera = { ...cameraGoal }
    cameraReturnAt = 0
    floorCacheKey = ''
    renderTicker()
    if (isActive) { draw(); wake() }
  })
  $('#office-names').checked = showNames
  $('#office-names').addEventListener('change', event => {
    showNames = event.target.checked
    remember('fleet-office-names', showNames ? 'on' : 'off')
    if (isReduced()) draw()
  })
  $('#office-chime').checked = soundOn
  $('#office-chime').addEventListener('change', event => {
    soundOn = event.target.checked
    remember('fleet-office-chime', soundOn ? 'on' : 'off')
    if (soundOn) chime()
  })
  $('#office-snapshot').addEventListener('click', snapshot)
  $('#office-clip').addEventListener('click', recordClip)
  $('#office-wall').addEventListener('click', toggleWallMode)
  $('#office-zoom-in').addEventListener('click', () => zoomAround(camera.zoom * 1.35, view.cssWidth / 2, view.cssHeight / 2))
  $('#office-zoom-out').addEventListener('click', () => zoomAround(camera.zoom / 1.35, view.cssWidth / 2, view.cssHeight / 2))
  $('#office-zoom-fit').addEventListener('click', () => { cameraReturnAt = 0; setCamera({ zoom: 1, x: 0, y: 0 }) })
  new ResizeObserver(() => { if (isActive) draw() }).observe(canvas.parentElement)
  document.addEventListener('visibilitychange', wake)
  motionQuery.addEventListener('change', () => { settleAll(); renderTicker(); wake() })
  // The clock, the sky and relative times in the ticker move even when nothing else does.
  setInterval(() => { renderTicker(); if (isActive && isReduced()) draw() }, 30_000)

  // One still frame of the whole office, fitted into another canvas at its own
  // size: the List view's preview. Everything the main canvas keeps between
  // frames (its size, the floor cache, the hit boxes for hover) is put back.
  let miniFloor = null, miniFloorKey = ''
  function fitMini(target) {
    const { minX, maxX, minY, maxY } = worldBounds()
    const spanX = maxX - minX, spanY = maxY - minY
    // As tall as the room is for its width, so the preview has no empty bands.
    const cssWidth = Math.floor(target.clientWidth)
    const cssHeight = Math.max(110, Math.min(240, Math.round(cssWidth * spanY / spanX)))
    if (!cssWidth) return false
    if (target.style.height !== cssHeight + 'px') target.style.height = cssHeight + 'px'
    const scale = Math.min(cssWidth / spanX, cssHeight / spanY)
    const ratio = window.devicePixelRatio || 1
    const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2
    view = { scale, baseScale: scale, ratio, cssWidth, cssHeight, spanX, spanY, baseCenterX: centerX, baseCenterY: centerY, offsetX: cssWidth / 2 - centerX * scale, offsetY: cssHeight / 2 - centerY * scale }
    if (target.width !== Math.round(cssWidth * ratio) || target.height !== Math.round(cssHeight * ratio)) {
      target.width = Math.round(cssWidth * ratio)
      target.height = Math.round(cssHeight * ratio)
    }
    return true
  }
  function drawMini(target) {
    if (isActive || !target || !target.clientWidth) return
    // Nobody walks while the Office tab is closed: everyone is simply where they belong.
    settleAll()
    const saved = { canvas, mainPen, pen, view, floorCache, floorCacheKey, hitBoxes, lights, hoveredKey, showNames }
    canvas = target
    mainPen = target.getContext('2d')
    floorCache = miniFloor
    floorCacheKey = miniFloorKey
    hoveredKey = ''
    showNames = false
    try {
      draw(() => fitMini(target))
    } finally {
      miniFloor = floorCache
      miniFloorKey = floorCacheKey
      ;({ canvas, mainPen, pen, view, floorCache, floorCacheKey, hitBoxes, lights, hoveredKey, showNames } = saved)
    }
  }

  return {
    sync,
    drawMini,
    setActive(next) {
      isActive = next
      if (next) { lastFrameAt = 0; if (isReduced()) settleAll(); draw(); wake() } else if (frameId) { cancelAnimationFrame(frameId); frameId = 0; lastFrameAt = 0 }
    },
    themeChanged() { refreshColors(); floorCacheKey = ''; for (const person of people.values()) if (person.kind !== 'helper') person.shirt = colors.shirts[hashOf(person.key) % colors.shirts.length]; for (const segment of layout.segments) segment.color = colors.shirts[hashOf(segment.key) % colors.shirts.length]; if (isActive) draw() },
    get isAnimating() { return Boolean(frameId) },
  }
}

// Built once by main.js, at the point in the start-up order where the page used to
// build it: it reads the DOM, adds its listeners and starts its timer.
export let office = null
export function startOffice() {
  office = createOffice()
  // The screenshot and demo harnesses call office.themeChanged() and office.drawMini().
  window.office = office
}
