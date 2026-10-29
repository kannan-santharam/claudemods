import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { READ_ITERM_TAB, READ_TERMINAL_TAB, TYPE_INTO_ITERM, TYPE_INTO_TAB, osascript } from './applescript.mjs'
import { HOME } from './constants.mjs'
import { MODELS, MODEL_IDS } from './new-sessions.mjs'
import { baseModel } from './pricing.mjs'
import { hasMod } from './registry.mjs'
import { heartbeats, live, messaging, modelSwitchesAnswering } from './state.mjs'
import { MESSAGE_TTL_MS } from './typing.mjs'
import { cleanLine } from './utils.mjs'

// /model and /rename: a connected session runs them itself; any other session
// has them typed into its tab, which only works while it waits at an empty prompt.

export async function runSessionCommand(body) {
  const session = live.get(String(body.sessionId || ''))
  if (!session) return { ok: false, reason: 'That session is no longer running.' }
  const command = String(body.command || '')
  let args = ''
  if (command === 'model') {
    args = String(body.args || '')
    if (!MODEL_IDS.has(args)) return { ok: false, reason: 'Unknown model.' }
  } else if (command === 'rename') {
    args = cleanLine(body.args, 80)
    if (!args) return { ok: false, reason: 'Give it a name.' }
  } else if (command === 'compact') {
    // Optional: what the summary should keep, as /compact takes it.
    args = cleanLine(body.args, 500)
  } else return { ok: false, reason: 'Only /model, /rename and /compact can be sent.' }

  messaging.inbox.push({ id: crypto.randomUUID(), sessionId: session.sessionId, text: `/${command}${args ? ' ' + args : ''}`, command, args, createdAt: Date.now(), claimedAt: 0, claimedBy: '' })
  if (command === 'model') void answerModelQuestion(session.sessionId, args)
  return { ok: true, via: hasMod(session.sessionId) ? 'command' : 'typed' }
}

// /model asks "Switch model?" in the terminal when the conversation is cached
// for the current model. The person already confirmed the switch in the
// dashboard, which showed the same warning, so once that question is on screen
// in the session's tab, offering exactly this model, Return picks its "Yes".
// Nothing is pressed unless the question is there.

// /model also saves the model as the default for new sessions. A switch from
// the dashboard is for that one session, so the saved default is put back as
// it was (only its "model" key; the rest of the file is left as it is).
const USER_SETTINGS = path.join(HOME, '.claude', 'settings.json')
function readDefaultModel() {
  try { return JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8')).model } catch { return undefined }
}
function restoreDefaultModel(model) {
  try {
    const settings = JSON.parse(fs.readFileSync(USER_SETTINGS, 'utf8'))
    if (settings.model === model) return false
    if (model === undefined) delete settings.model
    else settings.model = model
    fs.writeFileSync(USER_SETTINGS, JSON.stringify(settings, null, 2) + '\n')
    return true
  } catch {
    return false
  }
}
async function answerModelQuestion(sessionId, model) {
  if (modelSwitchesAnswering.has(sessionId)) return
  modelSwitchesAnswering.add(sessionId)
  const label = MODELS.find(option => option.id === model)?.label || model
  const defaultBefore = readDefaultModel()
  const deadline = Date.now() + MESSAGE_TTL_MS
  let isAnswered = false, isRestored = false, quietPolls = 0
  try {
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 2000))
      if (readDefaultModel() !== defaultBefore) isRestored = restoreDefaultModel(defaultBefore) || isRestored
      if (isRestored) return
      // Switched without saving a default (or not yet saved): give it a few polls.
      const session = live.get(sessionId)
      if (!session) return
      if (baseModel(heartbeats.get(sessionId)?.model) === model && ++quietPolls > 3) return
      if (isAnswered || !session.tty) continue
      for (const [reader, typer] of [[READ_TERMINAL_TAB, TYPE_INTO_TAB], [READ_ITERM_TAB, TYPE_INTO_ITERM]]) {
        const screen = (await osascript(reader, `/dev/${session.tty}`)).stdout
        const lastLines = screen.trimEnd().split('\n').slice(-12).join('\n')
        if (lastLines.includes('Switch model?') && new RegExp(`❯\\s*1\\.\\s*Yes, switch to ${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lastLines)) {
          await osascript(typer, `/dev/${session.tty}`, '\r')
          isAnswered = true
          break
        }
      }
    }
  } finally {
    modelSwitchesAnswering.delete(sessionId)
  }
}
