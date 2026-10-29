import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { PROJECTS_DIR, SESSION_ID_PATTERN } from './constants.mjs'
import { isExcludedPath } from './config.mjs'
import { insideHome } from './folder-browser.mjs'
import { startHidden } from './hidden-sessions.mjs'
import { MODEL_IDS } from './new-sessions.mjs'
import { baseModel } from './pricing.mjs'
import { live } from './state.mjs'
import { openInTerminal } from './terminal.mjs'
import { shellQuote } from './utils.mjs'

async function readSlice(filePath, start, length) {
  const handle = await fsp.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

// What a past session was about, from the head and tail of its transcript: no
// need to read a 20 MB file to name it.
async function describeTranscript(filePath, size) {
  const head = await readSlice(filePath, 0, Math.min(size, 256 * 1024))
  const tail = size > 256 * 1024 ? await readSlice(filePath, size - 128 * 1024, 128 * 1024) : ''
  const facts = { cwd: '', agentName: '', title: '', firstPrompt: '', lastPrompt: '', prompts: 0, model: '' }
  const readLines = (text, isTail) => {
    const lines = text.split('\n')
    if (isTail) lines.shift()
    for (const line of lines) {
      if (!line || line[0] !== '{') continue
      let row
      try {
        row = JSON.parse(line)
      } catch {
        continue
      }
      if (row.cwd && !facts.cwd) facts.cwd = row.cwd
      if (row.type === 'agent-name' && row.agentName) facts.agentName = String(row.agentName)
      if (row.type === 'custom-title' && row.customTitle) facts.title = String(row.customTitle)
      if (row.type === 'assistant' && row.message?.model && row.message.model !== '<synthetic>') facts.model = baseModel(row.message.model)
      const content = row.message?.content
      if (row.type === 'user' && !row.isMeta && typeof content === 'string') {
        const text = content.trim()
        if (!text || text.startsWith('<')) continue
        if (!facts.firstPrompt) facts.firstPrompt = text.slice(0, 200)
        facts.lastPrompt = text.slice(0, 300)
        if (!isTail) facts.prompts++
      }
    }
  }
  readLines(head, false)
  if (tail) readLines(tail, true)
  return facts
}

export async function listHistory(folderPath) {
  const realFolder = insideHome(folderPath)
  if (!realFolder || isExcludedPath(realFolder)) return { ok: false, reason: 'Pick a folder inside your home folder.' }
  const folder = { path: realFolder }
  const slug = folder.path.replace(/[^a-zA-Z0-9]/g, '-')
  let projectDirs = []
  try {
    projectDirs = (await fsp.readdir(PROJECTS_DIR)).filter(name => name === slug || name.startsWith(slug + '-'))
  } catch {}
  const candidates = []
  for (const dir of projectDirs) {
    let names = []
    try {
      names = await fsp.readdir(path.join(PROJECTS_DIR, dir))
    } catch {
      continue
    }
    for (const name of names) {
      const sessionId = name.replace(/\.jsonl$/, '')
      if (!name.endsWith('.jsonl') || !SESSION_ID_PATTERN.test(sessionId)) continue
      try {
        const full = path.join(PROJECTS_DIR, dir, name)
        const stat = await fsp.stat(full)
        if (stat.size > 0) candidates.push({ sessionId, full, size: stat.size, lastAt: stat.mtimeMs })
      } catch {}
    }
  }
  candidates.sort((left, right) => right.lastAt - left.lastAt)
  const liveIds = new Set(live.keys())
  const sessions = []
  for (const candidate of candidates.slice(0, 60)) {
    const facts = await describeTranscript(candidate.full, candidate.size)
    // A slug also matches a sibling (api → api-docs): the rows' cwd decides.
    if (!facts.cwd || !(facts.cwd === folder.path || facts.cwd.startsWith(folder.path + '/'))) continue
    if (!facts.firstPrompt) continue
    sessions.push({
      sessionId: candidate.sessionId,
      name: facts.agentName || facts.title || facts.firstPrompt.split(/\s+/).slice(0, 10).join(' '),
      firstPrompt: facts.firstPrompt,
      lastPrompt: facts.lastPrompt,
      prompts: facts.prompts,
      model: facts.model,
      cwd: facts.cwd,
      subfolder: facts.cwd === folder.path ? '' : facts.cwd.slice(folder.path.length + 1),
      lastAt: candidate.lastAt,
      sizeBytes: candidate.size,
      isLive: liveIds.has(candidate.sessionId),
    })
    if (sessions.length >= 40) break
  }
  return { ok: true, sessions }
}

export async function resumeSession(body) {
  const sessionId = String(body.sessionId || '')
  if (!SESSION_ID_PATTERN.test(sessionId)) return { ok: false, reason: 'Not a session id.' }
  if (live.has(sessionId)) return { ok: false, reason: live.get(sessionId).hidden ? 'That session is already running hidden: open it from its row.' : 'That session is already running: use Open tab.' }
  const model = String(body.model || '')
  if (model && !MODEL_IDS.has(model)) return { ok: false, reason: 'Unknown model.' }
  let found = ''
  for (const dir of await fsp.readdir(PROJECTS_DIR).catch(() => [])) {
    const candidate = path.join(PROJECTS_DIR, dir, `${sessionId}.jsonl`)
    if (fs.existsSync(candidate)) {
      found = candidate
      break
    }
  }
  if (!found) return { ok: false, reason: 'Its transcript was not found.' }
  const facts = await describeTranscript(found, (await fsp.stat(found)).size)
  if (!facts.cwd || !fs.existsSync(facts.cwd)) return { ok: false, reason: `Its folder is gone: ${facts.cwd || 'unknown'}` }
  if (isExcludedPath(facts.cwd)) return { ok: false, reason: 'That folder is excluded from the fleet.' }
  const command = [`cd ${shellQuote(facts.cwd)} &&`, 'claude', `--resume ${sessionId}`, model ? `--model ${shellQuote(model)}` : '']
    .filter(Boolean)
    .join(' ')
  if (body.hidden === true) return startHidden(facts.cwd, ['--resume', sessionId, ...(model ? ['--model', model] : [])])
  return openInTerminal(command)
}
