// Starting a new session: the models offered, the folder list, and the command
// that opens it in a terminal tab or as a hidden session.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isExcludedPath } from './config.mjs'
import { SYSTEM_FOLDERS, insideHome } from './folder-browser.mjs'
import { startHidden } from './hidden-sessions.mjs'
import { isNewer } from './pricing.mjs'
import { settings } from './state.mjs'
import { openInTerminal } from './terminal.mjs'
import { cleanLine, shellQuote } from './utils.mjs'

// The models offered come from the price table in use, which is read from
// Anthropic's pricing page each day, so a new model shows up without an
// update: the newest of each family that anyone can pick, dearest first, and
// any other listed model in `alsoIds` (the ones running sessions are on).
export const modelLabel = id => id.replace(/^claude-/, '').replace(/^[a-z]/, letter => letter.toUpperCase()).replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1')
export const isKnownModel = id => Object.hasOwn(settings.pricing.models, id)
export function offeredModels(alsoIds = []) {
  const models = settings.pricing.models
  const newest = new Map()
  for (const [id, rate] of Object.entries(models)) {
    const family = id.match(/^claude-([a-z]+)-/)?.[1]
    if (!family || rate.isLimited) continue
    if (!newest.has(family) || isNewer(id, newest.get(family))) newest.set(family, id)
  }
  const ids = [...newest.values()].sort((left, right) => models[right].input - models[left].input)
  for (const id of alsoIds) if (isKnownModel(id) && !ids.includes(id)) ids.push(id)
  return [{ id: '', label: 'Default (your settings)' }, ...ids.map(id => ({ id, label: modelLabel(id) }))]
}

export async function listFolders() {
  let entries = []
  try {
    entries = await fsp.readdir(settings.newSessionRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const folders = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SYSTEM_FOLDERS.has(entry.name)) continue
    const full = path.join(settings.newSessionRoot, entry.name)
    if (isExcludedPath(full)) continue
    folders.push({ name: entry.name, path: full, isGit: fs.existsSync(path.join(full, '.git')) })
  }
  return folders.sort((left, right) => left.name.localeCompare(right.name))
}

export async function startSession(body) {
  const folderPath = insideHome(body.folder)
  if (!folderPath || isExcludedPath(folderPath)) return { ok: false, reason: 'Pick a folder inside your home folder.' }
  const model = String(body.model || '')
  if (model && !isKnownModel(model)) return { ok: false, reason: 'Unknown model.' }
  const name = cleanLine(body.name, 80)
  const command = [
    `cd ${shellQuote(folderPath)} &&`,
    'claude',
    model ? `--model ${shellQuote(model)}` : '',
    name ? `--name ${shellQuote(name)}` : '',
  ].filter(Boolean).join(' ')
  if (body.hidden === true) return startHidden(folderPath, [...(model ? ['--model', model] : []), ...(name ? ['--name', name] : [])])
  return openInTerminal(command)
}
