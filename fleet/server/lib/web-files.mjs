// The page is server/web/: index.html, its stylesheets in css/ and its modules in
// js/. What can be served is an allowlist built from a listing of that folder,
// never a path taken from the request: URL path -> { file, type, mtimeMs, body }.
// Only plain lowercase names count, symlinks are skipped, and nothing else under
// web/ (or outside it) can ever be named by a URL.

import fsp from 'node:fs/promises'
import path from 'node:path'
import { WEB_DIR } from './constants.mjs'
import { webState } from './state.mjs'

const WEB_FILE_NAME = /^[a-z0-9-]+\.(css|js)$/
const WEB_FOLDER_NAME = /^[a-z0-9-]+$/
const RESCAN_INTERVAL_MS = 2000
const WEB_TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' }

async function listWebFolder(folder, urlPrefix, extension, depth, found) {
  let entries = []
  try {
    entries = await fsp.readdir(folder, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isFile() && WEB_FILE_NAME.test(entry.name) && entry.name.endsWith('.' + extension)) {
      found.set(`${urlPrefix}/${entry.name}`, { file: path.join(folder, entry.name), type: WEB_TYPES[extension] })
    } else if (entry.isDirectory() && depth > 0 && WEB_FOLDER_NAME.test(entry.name)) {
      await listWebFolder(path.join(folder, entry.name), `${urlPrefix}/${entry.name}`, extension, depth - 1, found)
    }
  }
}

// Each file is read when listed and again only when it changes, so a plugin
// update that removes the old folder never leaves this server unable to serve
// the page: a listing that finds no web/ at all keeps what it had, and one that
// finds no index.html keeps the page already in memory.
async function scanWebFiles() {
  const found = new Map()
  try {
    if ((await fsp.lstat(path.join(WEB_DIR, 'index.html'))).isFile()) {
      found.set('/', { file: path.join(WEB_DIR, 'index.html'), type: WEB_TYPES.html })
    }
  } catch {}
  await listWebFolder(path.join(WEB_DIR, 'css'), '/css', 'css', 0, found)
  await listWebFolder(path.join(WEB_DIR, 'js'), '/js', 'js', 3, found)
  if (!found.size) return
  for (const [urlPath, entry] of found) {
    const kept = webState.files.get(urlPath)
    if (kept && kept.file === entry.file) found.set(urlPath, kept)
    else if (!(await refreshWebFile(entry))) found.delete(urlPath)
  }
  if (!found.has('/') && webState.files.has('/')) found.set('/', webState.files.get('/'))
  webState.files = found
}

// Lists web/ unless a listing is already running, in which case the caller
// waits for that one. Called once at start-up and again on a miss.
export function loadWebFiles() {
  webState.scan ||= scanWebFiles().finally(() => {
    webState.scan = null
    webState.scannedAt = Date.now()
  })
  return webState.scan
}

// Re-reads a file whose modification time changed. A file that cannot be read
// (gone halfway through a plugin update) keeps the body already in memory; one
// that is no longer a regular file, a symlink put in its place, is false and
// is dropped by the caller.
async function refreshWebFile(entry) {
  try {
    const stat = await fsp.lstat(entry.file)
    if (!stat.isFile()) return false
    if (stat.mtimeMs !== entry.mtimeMs) Object.assign(entry, { mtimeMs: stat.mtimeMs, body: await fsp.readFile(entry.file) })
  } catch {}
  return true
}

// A path not in the list is looked for once more, so a file added to web/
// is served without a restart. Only paths shaped like the page's are, and at
// most one listing every two seconds, so unknown paths cannot keep re-listing
// the folder. Until index.html has been read once, / is an empty page, not a 404.
export async function readWebFile(urlPath) {
  if (!webState.files.has(urlPath) && (urlPath === '/' || /^\/(css|js)\//.test(urlPath))) {
    if (webState.scan || Date.now() - webState.scannedAt >= RESCAN_INTERVAL_MS) await loadWebFiles()
  }
  let entry = webState.files.get(urlPath)
  if (entry && !(await refreshWebFile(entry))) {
    if (webState.files.get(urlPath) === entry) webState.files.delete(urlPath)
    entry = null
  }
  if (urlPath === '/' && !entry?.body) return { type: WEB_TYPES.html, body: '' }
  return entry?.body ? entry : null
}
