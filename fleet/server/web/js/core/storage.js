// The folder last picked in each dialog, kept in this browser only.
export function remembered(key) { try { return localStorage.getItem(key) || '' } catch { return '' } }
export function remember(key, value) { try { localStorage.setItem(key, value) } catch {} }
