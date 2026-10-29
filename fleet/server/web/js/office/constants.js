// The office's fixed numbers and words: the isometric tile and wall sizes,
// walking speed, room proportions, the palettes people are dressed from, which
// tools count as editing, reading, the web, the shell or delegating, the
// timings of trips and alerts, and the labels the tooltip uses.

export const TILE_X = 32, TILE_Y = 16, WALL_HEIGHT = 84
export const SLANT = Math.hypot(TILE_X, TILE_Y)
export const WALK_SPEED = 3.2 // tiles per second
export const LOUNGE_WIDTH = 4.8, DESK_STEP_X = 2.4, DESK_STEP_Y = 2.9, GROUP_GAP = 0.9, UTILITY_WIDTH = 2.9
export const SKIN_TONES = ['#f2c9a8', '#e3b08b', '#c98d66', '#9e6845', '#6e4a33']
export const HAIR_COLORS = ['#2b2118', '#5a3a22', '#8a5a2b', '#caa052', '#3b3b3b', '#a33d2b', '#d9d4cc']
export const SHIRT_TOKENS = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6', '--series-7']
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
export const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'WebFetch', 'WebSearch', 'ToolSearch', 'NotebookRead'])
export const WEB_TOOLS = new Set(['WebFetch', 'WebSearch'])
export const SHELL_TOOLS = new Set(['Bash', 'BashOutput', 'KillShell', 'Monitor'])
export const DELEGATE_TOOLS = new Set(['Agent', 'Task', 'SendMessage'])
export const LONG_COMMAND_MS = 20_000 // a command running this long is watched from the racks
export const TRIP_MIN_MS = 8_000, TRIP_COOLDOWN_MS = 15_000
export const WAIT_ALERT_MS = 120_000
export const ACTIVITY_LABEL = {
  typing: 'editing files', reading: 'reading and searching', terminal: 'running commands', thinking: 'thinking',
  supervising: 'watching its helpers', waiting: 'needs your input', idle: 'in the lounge', relaxing: 'resting at its desk',
}
export const TRIP_LABEL = { globe: 'searching the web at the globe', racks: 'watching a long command at the racks' }
export const OUTFIT_LABEL = { blazer: 'blazer (Opus)', hoodie: 'hoodie (Sonnet)', beanie: 'beanie (Haiku)', headphones: 'headphones (Fable)' }
