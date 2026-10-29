import fs from 'node:fs'
import { CONFIG_FILE, DEFAULT_CONFIG, HOME } from './constants.mjs'
import { excludedDirCache, files, live, settings } from './state.mjs'
import { writePrivate } from './utils.mjs'

export function loadConfig() {
  let config = DEFAULT_CONFIG
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    try {
      writePrivate(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2))
    } catch {}
  }
  const expand = entry => String(entry).replace(/^~(?=\/|$)/, HOME).replace(/\/+$/, '')
  settings.excludedRoots = (Array.isArray(config.excludePaths) ? config.excludePaths : []).map(expand).filter(Boolean)
  settings.newSessionRoot = expand(config.newSessionRoot || DEFAULT_CONFIG.newSessionRoot)
  for (const sessionId of [...live.keys()]) if (isExcludedPath(live.get(sessionId).cwd)) live.delete(sessionId)
}

export function isExcludedPath(cwd) {
  return Boolean(cwd) && settings.excludedRoots.some(root => cwd === root || cwd.startsWith(root + '/'))
}

// A project folder under ~/.claude/projects is its cwd with every non-alphanumeric
// as '-', so a slug match can also be a sibling (~/api against ~/api-docs). The
// cwd a transcript records decides; its folder is skipped without being read.

export function isExcludedProjectDir(dirName, sampleFile) {
  const rootsKey = settings.excludedRoots.join('\n')
  const cached = excludedDirCache.get(dirName)
  if (cached && cached.rootsKey === rootsKey) return cached.isExcluded
  let isExcluded = false
  const matches = settings.excludedRoots.some(root => {
    const slug = root.replace(/[^a-zA-Z0-9]/g, '-')
    return dirName === slug || dirName.startsWith(slug + '-')
  })
  if (matches) {
    let cwd = ''
    try {
      const handle = fs.openSync(sampleFile, 'r')
      const buffer = Buffer.alloc(64 * 1024)
      const length = fs.readSync(handle, buffer, 0, buffer.length, 0)
      fs.closeSync(handle)
      cwd = buffer.subarray(0, length).toString('utf8').match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1] ?? ''
      cwd = cwd ? JSON.parse(`"${cwd}"`) : ''
    } catch {}
    isExcluded = cwd ? isExcludedPath(cwd) : settings.excludedRoots.some(root => dirName === root.replace(/[^a-zA-Z0-9]/g, '-'))
  }
  excludedDirCache.set(dirName, { rootsKey, isExcluded })
  return isExcluded
}

export function includedFiles() {
  return [...files.values()].filter(state => !isExcludedPath(state.cwd))
}
