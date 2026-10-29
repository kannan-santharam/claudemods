// This browser's remembered choices. Storage can be blocked (a private window,
// cleared site data), so every read and write is allowed to fail quietly.

// The folder last picked in each dialog, kept in this browser only.
export function remembered(key) { try { return localStorage.getItem(key) || '' } catch { return '' } }
export function remember(key, value) { try { localStorage.setItem(key, value) } catch {} }
