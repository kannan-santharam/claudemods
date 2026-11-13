// Where a session is really working. A session is listed under the folder it
// was started in, but its work is often somewhere else: another repository, or
// a worktree of this one. Its transcript says where: the folders of the files
// it edits, and the folders it runs git's writing commands in. The most recent
// of those that sits in a git repository is its workplace, and that
// repository's checked-out branch is read from its HEAD file when asked for.
// Fixed rules only: no model, and nothing is run.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { baseName } from './utils.mjs'

const QUOTED_PATH = `(?:"([^"]+)"|'([^']+)'|([^\\s;&|)]+))`
// Commands that change a repository, as against ones that only look at it.
const GIT_WRITE = new RegExp(`\\bgit\\s+(?:-C\\s+${QUOTED_PATH}\\s+)?(?:add|commit|push|checkout|switch|merge|rebase|stash|worktree)\\b`)
const GIT_FOLDER_FLAG = new RegExp(`\\bgit\\s+-C\\s+${QUOTED_PATH}`)
const CHANGE_FOLDER = new RegExp(`(?:^|[;&|(]\\s*)cd\\s+${QUOTED_PATH}`)
const PLACES_KEPT = 40
const PLACES_READ = 12
const OTHERS_SHOWN = 3
const REPO_CACHE_MS = 10_000
const HEAD_BYTES = 400
const CLIMB_LIMIT = 40

const home = os.homedir()
const expanded = text => (text === '~' || text.startsWith('~/') ? home + text.slice(1) : text.startsWith('$HOME/') ? home + text.slice(5) : text)
const pathIn = match => (match ? match[1] || match[2] || match[3] : '')

// The folder a Bash command changes a repository in: the one it names with
// `git -C` or `cd`, else the shell's own. Empty when it changes none, or names
// the folder in a way that cannot be read from the text (a variable).
export function bashWorkFolder(command, shellFolder) {
  const text = String(command || '')
  if (!GIT_WRITE.test(text)) return ''
  const named = pathIn(text.match(GIT_FOLDER_FLAG)) || pathIn(text.match(CHANGE_FOLDER))
  const folder = named ? expanded(named) : String(shellFolder || '')
  return path.isAbsolute(folder) ? path.normalize(folder) : ''
}

// places: folder -> when the session last worked there, newest last.
export function noteWorkPlace(places, folder, time) {
  if (!folder || !path.isAbsolute(folder)) return
  places.delete(folder)
  places.set(folder, time || Date.now())
  if (places.size > PLACES_KEPT) places.delete(places.keys().next().value)
}

function headBranch(gitFolder) {
  try {
    const head = fs.readFileSync(path.join(gitFolder, 'HEAD'), 'utf8').slice(0, HEAD_BYTES).trim()
    const named = head.match(/^ref: refs\/heads\/([^\s\x00-\x1f]+)$/)
    return named ? named[1].slice(0, 120) : /^[0-9a-f]{7,64}$/.test(head) ? head.slice(0, 7) : ''
  } catch {
    return ''
  }
}

// A worktree's .git is a file naming the folder that holds its HEAD.
function linkedGitFolder(file, folder) {
  try {
    const named = fs.readFileSync(file, 'utf8').slice(0, 2000).match(/^gitdir: (.+)$/m)
    return named ? path.resolve(folder, named[1].trim()) : ''
  } catch {
    return ''
  }
}

const repoCache = new Map() // folder -> { at, repo }
// The repository a folder sits in, { root, branch }, or null.
export function repoOf(folder) {
  if (!folder || !path.isAbsolute(folder)) return null
  const cached = repoCache.get(folder)
  if (cached && Date.now() - cached.at < REPO_CACHE_MS) return cached.repo
  let repo = null
  let current = folder
  for (let climbed = 0; climbed < CLIMB_LIMIT; climbed++) {
    const dotGit = path.join(current, '.git')
    let stat = null
    try { stat = fs.statSync(dotGit) } catch {}
    if (stat) {
      const gitFolder = stat.isDirectory() ? dotGit : linkedGitFolder(dotGit, current)
      let root = current
      try { root = fs.realpathSync(current) } catch {}
      repo = { root, branch: gitFolder ? headBranch(gitFolder) : '' }
      break
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  if (repoCache.size > 500) repoCache.clear()
  repoCache.set(folder, { at: Date.now(), repo })
  return repo
}

// The repository a session last worked in when that is not the one it was
// started in: { path, folder, branch, at, others }, or null when its work is
// at home or has left no trace. `others` are further repositories it worked in.
export function workPlaceOf(startFolder, places) {
  if (!places?.size) return null
  const start = repoOf(startFolder)
  const repos = new Map()
  for (const [folder, at] of [...places].sort((first, second) => second[1] - first[1]).slice(0, PLACES_READ)) {
    const repo = repoOf(folder)
    if (repo && !repos.has(repo.root)) repos.set(repo.root, { path: repo.root, folder: baseName(repo.root), branch: repo.branch, at })
  }
  const [latest, ...earlier] = [...repos.values()]
  if (!latest || latest.path === start?.root) return null
  return { ...latest, others: earlier.filter(repo => repo.path !== start?.root).slice(0, OTHERS_SHOWN).map(({ folder, branch, path: root }) => ({ folder, branch, path: root })) }
}
