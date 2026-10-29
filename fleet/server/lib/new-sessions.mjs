// Starting a new session: the models offered, the folder list, and the command
// that opens it in a terminal tab or as a hidden session.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { isExcludedPath } from './config.mjs'
import { SYSTEM_FOLDERS, insideHome } from './folder-browser.mjs'
import { startHidden } from './hidden-sessions.mjs'
import { settings } from './state.mjs'
import { openInTerminal } from './terminal.mjs'
import { cleanLine, shellQuote } from './utils.mjs'

export const MODELS = [
  { id: '', label: 'Default (your settings)' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5' },
]
export const MODEL_IDS = new Set(MODELS.map(model => model.id).filter(Boolean))

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
  if (model && !MODEL_IDS.has(model)) return { ok: false, reason: 'Unknown model.' }
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
