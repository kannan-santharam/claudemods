// Fleet's hooks module: the one file the engine loads (hooks.json). It only wires
// hooks to the handlers in lib/, in the order they nest; what each one does is
// beside its code there.

import type { Register } from 'claude-code'

import { askPermissionOnDashboard, askQuestionOnDashboard, postCardWhenDialogOpens, racePermissionDialog } from './lib/asks'
import { runFleetCommand } from './lib/commands'
import { isThisSessionExcluded } from './lib/excluded'
import { INBOX_POLL_MS, deliverInbox } from './lib/messages'
import { markPaneClosed, renderPane } from './lib/pane'
import { REGISTRY_POLL_MS, scan } from './lib/scan'
import { SERVER_CHECK_MS, ensureServer, isServerHealthy, serverState } from './lib/server'
import { readIsOpen } from './lib/state'
import { HEARTBEAT_MS, heartbeat } from './lib/status'

// The engine reads matchers and the command's name off this file's source, so
// both are spelled here rather than imported: the pane's id is lib/pane.tsx's PANE.
const PANE = 'fleet'

export const register: Register = on => {
  on('session.start', async ($, event, next) => {
    await $.command.register({
      name: 'fleet',
      description: 'Toggle the dashboard pane of every Claude Code session on this machine; /fleet web opens it in the browser',
      argumentHint: '[web|close]',
    })
    $.clock.every(REGISTRY_POLL_MS, async () => {
      try {
        if (await readIsOpen($)) await scan($)
      } catch {
        // One bad tick (a git or tail that timed out) must not end the refresh.
      }
    })
    void ensureServer($).catch(() => undefined)
    $.clock.every(SERVER_CHECK_MS, async () => {
      try {
        // A server that came back (restarted by another session) is up again here too.
        serverState.isUp = (await isServerHealthy($)) || (await ensureServer($))
      } catch {
        serverState.isUp = false
      }
    })
    $.clock.every(HEARTBEAT_MS, async () => {
      if (!serverState.isUp || (await isThisSessionExcluded($))) return
      try {
        await heartbeat($)
      } catch {
        serverState.isUp = false
      }
    })
    $.clock.every(INBOX_POLL_MS, async () => {
      if (!serverState.isUp || (await isThisSessionExcluded($))) return
      try {
        await deliverInbox($)
      } catch {
        // The next poll asks again; an unacknowledged message is offered again.
      }
    })
    return next(event)
  })

  on('tool.check', askPermissionOnDashboard)

  on('tool.call', racePermissionDialog)

  on('tool.call', { tool: 'AskUserQuestion' }, askQuestionOnDashboard)

  on('classic.PermissionRequest', postCardWhenDialogOpens)

  // Answered here, not passed on: the engine sees this hook answer its own command.
  on('command.run', { command: 'fleet' }, async ($, event) => runFleetCommand($, event))

  on('ui.close', { id: PANE }, markPaneClosed)

  on('ui.render', { component: 'Pane', requestId: PANE }, renderPane)
}
