// The mod's $.state values (their contract is types/index.d.ts).

import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { FleetSend, FleetSession } from '../../types'

// Change a tag when that value's fields change: it declines what an earlier
// version stored, which outlives a reload.
const sessionsAtom = atom({ plugin: 'fleet', key: 'sessions' } as const, [], {
  shape: 'sessions-1',
})
const lastSendAtom = atom({ plugin: 'fleet', key: 'lastSend' } as const, [], {
  shape: 'send-1',
})
const selectedAtom = atom({ plugin: 'fleet', key: 'selected' } as const, '')
const isOpenAtom = atom({ plugin: 'fleet', key: 'isOpen' } as const, false)
const scannedAtAtom = atom({ plugin: 'fleet', key: 'scannedAt' } as const, 0)

// The engine reads every state source off the file that calls read or update,
// so the atoms are read and written here, and nowhere else.
export function readSessions($: EngineInterface): Promise<FleetSession[]> {
  return read($, sessionsAtom)
}

export async function writeSessions($: EngineInterface, sessions: FleetSession[]): Promise<void> {
  await update($, sessionsAtom, () => sessions)
}

export function readLastSend($: EngineInterface): Promise<FleetSend[]> {
  return read($, lastSendAtom)
}

export async function writeLastSend($: EngineInterface, results: FleetSend[]): Promise<void> {
  await update($, lastSendAtom, () => results)
}

export function readSelected($: EngineInterface): Promise<string> {
  return read($, selectedAtom)
}

export async function updateSelected($: EngineInterface, change: (current: string) => string): Promise<void> {
  await update($, selectedAtom, change)
}

export function readIsOpen($: EngineInterface): Promise<boolean> {
  return read($, isOpenAtom)
}

export async function writeIsOpen($: EngineInterface, isOpen: boolean): Promise<void> {
  await update($, isOpenAtom, () => isOpen)
}

export function readScannedAt($: EngineInterface): Promise<number> {
  return read($, scannedAtAtom)
}

export async function writeScannedAt($: EngineInterface, scannedAt: number): Promise<void> {
  await update($, scannedAtAtom, () => scannedAt)
}
