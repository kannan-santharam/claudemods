// Colour arithmetic on hex strings, and the office palette read from the
// page's CSS custom properties whenever the theme changes.

import { cssVariable } from '../core/dom.js'
import { SHIRT_TOKENS } from './constants.js'

function parseHex(hex) {
  const value = String(hex).replace('#', '')
  const full = value.length === 3 ? value.split('').map(character => character + character).join('') : value
  return [0, 2, 4].map(start => parseInt(full.slice(start, start + 2), 16) || 0)
}
export function mix(first, second, ratio) {
  const [red1, green1, blue1] = parseHex(first), [red2, green2, blue2] = parseHex(second)
  const blend = (fromChannel, toChannel) => Math.round(fromChannel + (toChannel - fromChannel) * ratio).toString(16).padStart(2, '0')
  return '#' + blend(red1, red2) + blend(green1, green2) + blend(blue1, blue2)
}
export const shade = (hex, ratio) => mix(hex, '#000000', ratio)
export const alpha = (hex, opacity) => { const [red, green, blue] = parseHex(hex); return `rgba(${red},${green},${blue},${opacity})` }
// The Office keeps its colours when the page around it goes grey: --office-* wins where set.
const officeCssVariable = name => cssVariable(name.replace(/^--/, '--office-')) || cssVariable(name)
export function refreshColors(scene) {
  const background = parseHex(cssVariable('--bg') || '#f4f4f2')
  const isDark = (background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114) / 255 < 0.45
  const floor = cssVariable('--surface-2')
  const wood = isDark ? ['#7a654b', '#5f4e3a', '#4d3f2f'] : ['#e6d4b4', '#cfb68f', '#bba077']
  scene.colors = {
    isDark,
    floorA: floor,
    floorB: mix(floor, cssVariable('--surface-3'), 0.6),
    plankA: mix(floor, wood[0], isDark ? 0.32 : 0.38),
    plankB: mix(floor, wood[1], isDark ? 0.32 : 0.34),
    plankLine: mix(floor, wood[2], isDark ? 0.5 : 0.5),
    floorEdge: [floor, shade(cssVariable('--surface-3'), 0.08), shade(cssVariable('--surface-3'), 0.16)],
    wallLeft: cssVariable('--surface-1'),
    wallBack: mix(cssVariable('--surface-1'), cssVariable('--surface-3'), 0.55),
    wallTop: cssVariable('--border'),
    border: cssVariable('--border'),
    text: cssVariable('--text-primary'),
    muted: cssVariable('--text-muted'),
    label: cssVariable('--surface-1'),
    accent: officeCssVariable('--accent'),
    accentSoft: officeCssVariable('--accent-soft'),
    critical: officeCssVariable('--critical'),
    warning: officeCssVariable('--series-4'),
    good: officeCssVariable('--good'),
    shirts: SHIRT_TOKENS.map(name => officeCssVariable(name)),
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
