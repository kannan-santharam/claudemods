// The /fleet slash command. It is registered, and its hook answered, in
// register.tsx, where the engine reads the command's name.

import type { EngineInterface, MatchedHook } from 'claude-code'

import { PANE, openPane } from './pane'
import { openBrowserDashboard } from './server'
import { readIsOpen, writeIsOpen } from './state'

type FleetCommandEvent = Parameters<MatchedHook<'command.run', { command: 'fleet' }>>[1]

// /fleet toggles the pane; /fleet close only closes it; /fleet web opens the browser.
export async function runFleetCommand($: EngineInterface, event: FleetCommandEvent): Promise<{ text: string }> {
  const args = String(event.args ?? '').trim()
  if (args === 'web') return { text: await openBrowserDashboard($) }
  if (args === 'close' || (args === '' && (await readIsOpen($)))) {
    await $.ui.close({ id: PANE })
    await writeIsOpen($, false)
    return { text: 'Fleet pane closed.' }
  }
  await openPane($)
  return { text: 'Fleet pane opened. Run /fleet again to close it.' }
}
