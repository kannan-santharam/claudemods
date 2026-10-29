import crypto from 'node:crypto'
import fs from 'node:fs'
import { PORT } from './constants.mjs'
import { loginCodes, secrets } from './state.mjs'

export function loadSecret(file) {
  try {
    const kept = fs.readFileSync(file, 'utf8').trim()
    if (/^[0-9a-f]{48}$/.test(kept)) {
      fs.chmodSync(file, 0o600)
      return kept
    }
  } catch {}
  const fresh = crypto.randomBytes(24).toString('hex')
  fs.writeFileSync(file, fresh, { mode: 0o600 })
  fs.chmodSync(file, 0o600)
  return fresh
}

export const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])

// The page may load Chart.js (pinned, with its integrity hash) and nothing else
// from outside, and may not be framed by another site.
export const PAGE_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ')

// Signing the browser in: a session's mod (which holds TOKEN) asks for a code
// good once for a minute, opens /auth?code=…, and the answer is an HttpOnly,
// SameSite=Strict cookie. Another account on this Mac, or a page elsewhere,
// gets nothing from loading the dashboard.

export function newLoginCode() {
  const now = Date.now()
  for (const [code, expiry] of loginCodes) if (expiry < now) loginCodes.delete(code)
  const code = crypto.randomBytes(18).toString('hex')
  loginCodes.set(code, now + 60000)
  return code
}
export function takeLoginCode(code) {
  const expiry = loginCodes.get(code)
  loginCodes.delete(code)
  return Boolean(expiry && expiry >= Date.now())
}
export const COOKIE_NAME = `fleet_${PORT}`

function safeEqual(given, expected) {
  return Boolean(expected) && given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}
function cookieValue(request) {
  for (const part of String(request.headers.cookie || '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE_NAME) return rest.join('=')
  }
  return ''
}
export function hasToken(request) {
  return safeEqual(String(request.headers['x-fleet-token'] || ''), secrets.token)
}

// A session's mod sends the token; the browser sends its cookie, and for
// anything that acts, a header no other site can make a browser send.
export function isAuthorized(request) {
  if (hasToken(request)) return true
  if (!safeEqual(cookieValue(request), secrets.browserSecret)) return false
  return request.method === 'GET' || request.headers['x-fleet-request'] === '1'
}
