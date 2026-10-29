// The office's one shared state. Every part of the office reads and changes
// this object, passed to it as `scene`: the canvases and pens it draws with,
// the people and where they belong, the camera, the ticker and the toggles.
// It is made once, by createOffice(), when the page starts.

import { $ } from '../core/dom.js'
import { remembered } from '../core/storage.js'
import { buildLayout } from './layout.js'

export function createScene() {
  // The Office canvas; drawMini lends both to a small canvas for one frame.
  const canvas = $('#office-canvas')
  const mainPen = canvas.getContext('2d')
  const lightCanvas = document.createElement('canvas')
  return {
    canvas,
    card: $('#office-card'),
    mainPen,
    lightCanvas,
    lightPen: lightCanvas.getContext('2d'),
    motionQuery: matchMedia('(prefers-reduced-motion: reduce)'),
    people: new Map(), // key -> person (a session, a helper or a robot)
    rackOf: new Map(), // sessionId -> rack slot
    loungeOf: new Map(), // sessionId -> lounge spot, while idle
    tripOf: new Map(), // sessionId -> { kind, slot }
    groupOrder: new Map(), // folder -> first seen order, so projects keep their place
    memberOrder: new Map(), // sessionId -> first seen order within the office
    previous: new Map(), // sessionId -> what the last sync saw, to spot what changed
    waitingSince: new Map(), // sessionId -> when it started waiting
    events: [], // the ticker, newest first
    effects: [], // parcels, planes and paper in flight
    outboxCount: 0,
    pen: mainPen,
    layout: buildLayout([], 0),
    colors: null,
    floorCache: null,
    floorCacheKey: '',
    view: { scale: 1, offsetX: 0, offsetY: 0, cssWidth: 0, cssHeight: 0, ratio: 1, baseCenterX: 0, baseCenterY: 0, spanX: 1, spanY: 1 },
    camera: { zoom: 1, x: 0, y: 0 },
    cameraGoal: { zoom: 1, x: 0, y: 0 },
    cameraReturnAt: 0,
    isActive: false,
    frameId: 0,
    lastFrameAt: 0,
    clockSeconds: 0,
    hoveredKey: '',
    hitBoxes: [],
    lights: [],
    hasSynced: false,
    liveIds: new Set(),
    planLimits: [],
    dimming: 0,
    nightness: 0,
    today: { commits: 0, pushes: 0, prompts: 0, working: 0 },
    showNames: remembered('fleet-office-names') !== 'off',
    soundOn: remembered('fleet-office-chime') === 'on',
    audio: null,
    orderCounter: 0,
    // Pointer state: a drag in progress, a click to swallow after one, a pending single click.
    drag: null,
    suppressClick: false,
    clickTimer: 0,
    // The clip being recorded, if any.
    recorder: null,
    // The List view's preview keeps its own floor cache.
    miniFloor: null,
    miniFloorKey: '',
  }
}

export const isReduced = scene => scene.motionQuery.matches
export const isWallMode = scene => document.fullscreenElement === scene.card
