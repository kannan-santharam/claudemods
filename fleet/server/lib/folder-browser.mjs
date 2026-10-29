// The folder picker: any folder under home can be browsed and picked; nothing
// outside it, nothing excluded.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { HOME } from './constants.mjs'
import { isExcludedPath } from './config.mjs'
import { settings } from './state.mjs'

// What a home folder holds besides projects, left out of the folder pickers.
export const SYSTEM_FOLDERS = new Set(['Applications', 'Library', 'Movies', 'Music', 'Pictures', 'Public', 'Desktop', 'Downloads'])

// Any folder under the home folder can be browsed and picked, followed through
// links to where it really is; nothing outside home, nothing excluded.
export function insideHome(target) {
  // realpath('') is the working directory: an empty path picks nothing.
  if (!target) return ''
  try {
    const real = fs.realpathSync(String(target || ''))
    const home = fs.realpathSync(HOME)
    if (real !== home && !real.startsWith(home + '/')) return ''
    return fs.statSync(real).isDirectory() ? real : ''
  } catch {
    return ''
  }
}

const SKIPPED_FOLDERS = new Set(['node_modules', '__pycache__', 'dist', 'build', '.git'])

export async function browse(target) {
  const home = fs.realpathSync(HOME)
  const real = insideHome(target) || insideHome(settings.newSessionRoot) || home
  if (isExcludedPath(real)) return { ok: false, reason: 'That folder is excluded from the fleet.' }
  let entries = []
  try {
    entries = await fsp.readdir(real, { withFileTypes: true })
  } catch {
    return { ok: false, reason: 'That folder cannot be read.' }
  }
  const folders = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || SKIPPED_FOLDERS.has(entry.name)) continue
    if (real === home && SYSTEM_FOLDERS.has(entry.name)) continue
    const full = path.join(real, entry.name)
    const isDirectory = entry.isDirectory() || (entry.isSymbolicLink() && Boolean(insideHome(full)))
    if (!isDirectory || isExcludedPath(full)) continue
    folders.push({ name: entry.name, path: full, isGit: fs.existsSync(path.join(full, '.git')) })
    if (folders.length >= 400) break
  }
  folders.sort((left, right) => Number(right.isGit) - Number(left.isGit) || left.name.localeCompare(right.name))
  const crumbs = [{ name: 'Home', path: home }]
  let walked = home
  for (const part of path.relative(home, real).split(path.sep).filter(Boolean)) {
    walked = path.join(walked, part)
    crumbs.push({ name: part, path: walked })
  }
  return { ok: true, path: real, isGit: fs.existsSync(path.join(real, '.git')), crumbs, folders }
}
