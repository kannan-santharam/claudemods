import * as asks from './asks.mjs'
import * as auth from './auth.mjs'
import * as messages from './messages.mjs'
import * as sessions from './sessions.mjs'
import * as views from './views.mjs'

// URL path -> handler({ request, response, url, body }), one table per stage of
// a request: public GETs before sign-in, then signed-in GETs, then POSTs.
export const publicGetRoutes = new Map(Object.entries(auth.publicRoutes))
export const getRoutes = new Map(Object.entries({ ...views.getRoutes, ...sessions.getRoutes, ...asks.getRoutes, ...messages.getRoutes }))
export const postRoutes = new Map(Object.entries({ ...auth.postRoutes, ...sessions.postRoutes, ...asks.postRoutes, ...messages.postRoutes }))
