// The request handler: the Host check, the page's static files, then the routing
// tables in a fixed order (see routes/index.mjs).

import { PORT } from './constants.mjs'
import { readBody, send } from './http.mjs'
import { getRoutes, postRoutes, publicGetRoutes } from './routes/index.mjs'
import { ALLOWED_HOSTS, isAuthorized } from './security.mjs'
import { log } from './utils.mjs'
import { readWebFile } from './web-files.mjs'

// The page's files may be kept by the browser but are checked on every load:
// the tag changes with the file's size or modification time, and an unchanged
// file answers 304 with no body. The security headers ride on both answers.
// The empty page served before index.html was ever read has no tag and stays
// no-store, like every /api answer.
function sendWebFile(request, response, page) {
  const etag = page.mtimeMs ? `"${page.body.length.toString(16)}-${Math.floor(page.mtimeMs).toString(16)}"` : ''
  const extra = etag ? { 'cache-control': 'no-cache', etag } : {}
  if (etag && request.headers['if-none-match'] === etag) return send(response, 304, '', page.type, extra)
  return send(response, 200, page.body, page.type, extra)
}

export async function handleRequest(request, response) {
  // A page on another origin, or a rebound DNS name, never gets in.
  if (!ALLOWED_HOSTS.has(String(request.headers.host || ''))) return send(response, 421, { error: 'wrong host' })
  // A path no URL can be made of (such as //) is refused rather than taking the server down.
  let url
  try {
    url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`)
  } catch {
    return send(response, 400, { error: 'bad request' })
  }
  try {
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const page = await readWebFile(url.pathname)
      if (page) return sendWebFile(request, response, page)
    }
    if (request.method === 'GET' && publicGetRoutes.has(url.pathname)) {
      return await publicGetRoutes.get(url.pathname)({ request, response, url })
    }
    if (!url.pathname.startsWith('/api/')) return send(response, 404, { error: 'not found' })
    if (!isAuthorized(request)) return send(response, 401, { error: 'missing or wrong token' })

    if (request.method === 'GET' && getRoutes.has(url.pathname)) {
      return await getRoutes.get(url.pathname)({ request, response, url })
    }
    if (request.method !== 'POST') return send(response, 405, { error: 'method' })
    const body = await readBody(request)

    if (postRoutes.has(url.pathname)) return await postRoutes.get(url.pathname)({ request, response, url, body })
    return send(response, 404, { error: 'not found' })
  } catch (error) {
    log('request failed', url.pathname, error.message)
    return send(response, 500, { error: 'server error' })
  }
}
