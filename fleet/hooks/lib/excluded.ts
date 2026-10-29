// Folders the person excluded on the dashboard, read from ~/.claude/fleet/config.json
// (the server writes it): sessions there are left out of the scan, send no
// heartbeat and take no messages.

import type { EngineInterface } from 'claude-code'

const DEFAULT_EXCLUDE_PATHS: string[] = []
let excludedRoots: string[] = []
let excludedRootsReadAt = 0

export async function readExcludedRoots($: EngineInterface, home: string, now: number): Promise<string[]> {
  if (now - excludedRootsReadAt < 30000 && excludedRootsReadAt) return excludedRoots
  let paths = DEFAULT_EXCLUDE_PATHS
  try {
    const config = JSON.parse(await $.fs.read(`${home}/.claude/fleet/config.json`))
    if (Array.isArray(config.excludePaths)) paths = config.excludePaths.map(String)
  } catch {
    // No config yet: the default stands until the server writes one.
  }
  excludedRoots = paths.map(entry => entry.replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')).filter(Boolean)
  excludedRootsReadAt = now
  return excludedRoots
}

export function isExcludedPath(roots: string[], cwd: string): boolean {
  return Boolean(cwd) && roots.some(root => cwd === root || cwd.startsWith(root + '/'))
}

// A session in an excluded folder neither reports to the dashboard nor takes its messages.
export async function isThisSessionExcluded($: EngineInterface): Promise<boolean> {
  const home = (await $.env.get('HOME')) ?? ''
  const roots = await readExcludedRoots($, home, await $.clock.now())
  return isExcludedPath(roots, await $.session.cwd())
}
