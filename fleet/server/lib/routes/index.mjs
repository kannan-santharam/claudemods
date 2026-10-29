// The routing tables. Each area of the API (sign-in, views, sessions, questions,
// messages) lists its paths in its own module; here they are merged into one
// table per stage of a request, in the order server.mjs checks them: public
// GETs before sign-in, then signed-in GETs, then POSTs. A handler takes
// { request, response, url, body } and answers through send().
import * as asks from './asks.mjs'
import * as auth from './auth.mjs'
import * as messages from './messages.mjs'
import * as sessions from './sessions.mjs'
import * as views from './views.mjs'

// Two areas claiming one path would make the answer depend on merge order: refuse to start.
function routeTable(...areas) {
  const table = new Map()
  for (const area of areas) {
    for (const [urlPath, handler] of Object.entries(area)) {
      if (table.has(urlPath)) throw new Error(`route ${urlPath} is defined twice`)
      table.set(urlPath, handler)
    }
  }
  return table
}

export const publicGetRoutes = routeTable(auth.publicRoutes)
export const getRoutes = routeTable(views.getRoutes, sessions.getRoutes, asks.getRoutes, messages.getRoutes)
export const postRoutes = routeTable(auth.postRoutes, sessions.postRoutes, asks.postRoutes, messages.postRoutes)
