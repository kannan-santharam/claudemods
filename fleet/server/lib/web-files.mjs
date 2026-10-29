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
// the page: a listing that finds no web/ at all keeps what it had.
export async function scanWebFiles() {
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
    else await refreshWebFile(entry)
  }
  webState.files = found
}

async function refreshWebFile(entry) {
  try {
    const stat = await fsp.stat(entry.file)
    if (stat.mtimeMs !== entry.mtimeMs) Object.assign(entry, { mtimeMs: stat.mtimeMs, body: await fsp.readFile(entry.file) })
  } catch {}
}

// A path not in the list is looked for once more, so a file added to web/
// is served without a restart. Only paths shaped like the page's are.
export async function readWebFile(urlPath) {
  if (!webState.files.has(urlPath) && (urlPath === '/' || /^\/(css|js)\//.test(urlPath))) {
    webState.scan ||= scanWebFiles().finally(() => { webState.scan = null })
    await webState.scan
  }
  const entry = webState.files.get(urlPath)
  if (!entry) return null
  await refreshWebFile(entry)
  return entry.body ? entry : null
}
