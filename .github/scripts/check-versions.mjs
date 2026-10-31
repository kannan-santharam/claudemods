// Every pull request that changes a mod must raise that mod's version, or the
// people who installed it are never offered the change: `claude plugin update`
// compares versions. A mod is a top-level folder with .claude-plugin/plugin.json.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const base = process.argv[2]
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' })
const changed = git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)
const mods = [...new Set(changed.map(file => file.split('/')[0]))].filter(folder => existsSync(`${folder}/.claude-plugin/plugin.json`))

const parts = version => String(version).split(/[.-]/).slice(0, 3).map(Number)
const isHigher = (next, previous) => {
  const [nextParts, previousParts] = [parts(next), parts(previous)]
  for (let index = 0; index < 3; index++) if (nextParts[index] !== previousParts[index]) return nextParts[index] > previousParts[index]
  return false
}

let failed = false
for (const mod of mods) {
  const manifest = `${mod}/.claude-plugin/plugin.json`
  const next = JSON.parse(readFileSync(manifest, 'utf8')).version
  let previous
  try {
    previous = JSON.parse(git('show', `${base}:${manifest}`)).version
  } catch {
    console.log(`${mod}: new mod at ${next}`)
    continue
  }
  if (isHigher(next, previous)) console.log(`${mod}: ${previous} -> ${next}`)
  else {
    console.log(`::error file=${manifest}::${mod} changed but its version is still ${next} (main has ${previous}). Raise "version" in ${manifest}.`)
    failed = true
  }
}
if (!mods.length) console.log('No mod changed.')
process.exit(failed ? 1 : 0)
