import { ENTRY_SCRIPT, PORT, VERSION } from '../constants.mjs'
import { send } from '../http.mjs'
import { COOKIE_NAME, hasToken, newLoginCode, takeLoginCode } from '../security.mjs'
import { secrets } from '../state.mjs'
import { log } from '../utils.mjs'

// Answered before any sign-in is checked.
export const publicRoutes = {
  '/auth': ({ response, url }) => {
    if (!takeLoginCode(url.searchParams.get('code') || '')) return send(response, 302, '', 'text/plain', { location: '/?signin=expired' })
    return send(response, 302, '', 'text/plain', {
      location: '/',
      'set-cookie': `${COOKIE_NAME}=${secrets.browserSecret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
    })
  },
  '/api/health': ({ response }) => {
    return send(response, 200, { ok: true, pid: process.pid, port: PORT, version: VERSION, script: ENTRY_SCRIPT })
  },
}

export const postRoutes = {
  '/api/login-code': ({ request, response }) => {
    if (!hasToken(request)) return send(response, 401, { error: 'only a session can sign a browser in' })
    return send(response, 200, { code: newLoginCode() })
  },
  // A session running a newer version of the plugin retires this server.
  '/api/shutdown': ({ request, response, body }) => {
    if (!hasToken(request)) return send(response, 401, { error: 'only a session can stop the server' })
    send(response, 200, { ok: true })
    log(`stopping for version ${String(body.version || '?')}`)
    setTimeout(() => process.exit(0), 200)
  },
}
