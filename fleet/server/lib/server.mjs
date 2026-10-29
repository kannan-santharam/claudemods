import { PORT } from './constants.mjs'
import { readBody, send } from './http.mjs'
import { getRoutes, postRoutes, publicGetRoutes } from './routes/index.mjs'
import { ALLOWED_HOSTS, isAuthorized } from './security.mjs'
import { log } from './utils.mjs'
import { readWebFile } from './web-files.mjs'

export async function handleRequest(request, response) {
  // A page on another origin, or a rebound DNS name, never gets in.
  if (!ALLOWED_HOSTS.has(String(request.headers.host || ''))) return send(response, 421, { error: 'wrong host' })
  const url = new URL(request.url || '/', `http://127.0.0.1:${PORT}`)
  try {
    if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
      const page = await readWebFile(url.pathname)
      if (page) return send(response, 200, page.body, page.type)
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
