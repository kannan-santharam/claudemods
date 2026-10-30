// The page's one shared state: what the server last sent, what is open, picked,
// typed or filtered. Modules read and change it in place; nothing is copied.

export const state = { live: null, report: null, range: '7d', measure: 'cost', open: new Set(), selected: new Set(), drafts: {}, fields: {}, collapsed: new Set(), showScreen: new Set(), screens: {}, conversations: {}, paneTab: {}, actionsMenu: '', filter: 'all', search: '', view: 'list', visible: [], options: null, charts: {}, lastLiveOk: 0 }
export const sessionById = id => (state.live?.sessions || []).find(session => session.sessionId === id)
export const fieldValue = (key, fallback) => state.fields[key] ?? fallback ?? ''
// The screenshot and demo harnesses read state.open from the page.
window.state = state
