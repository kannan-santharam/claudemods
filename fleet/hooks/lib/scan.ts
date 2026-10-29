import type { EngineInterface } from 'claude-code'

import type { FleetSession } from '../../types'
import { isExcludedPath, readExcludedRoots } from './excluded'
import { baseName, oneLine } from './format'
import { writeScannedAt, writeSessions } from './state'

export const REGISTRY_POLL_MS = 2000
const TRANSCRIPT_POLL_MS = 10000
const TRANSCRIPT_TAIL_BYTES = '400000'

type Registration = {
  pid: number
  sessionId: string
  cwd: string
  name?: string
  status?: string
  waitingFor?: string
  updatedAt?: number
  startedAt?: number
  version?: string
}

type TranscriptFacts = {
  readAt: number
  model: string
  contextTokens: number
  lastPrompt: string
}

// Module memory: a reload starts these over, which costs one slow read.
const transcriptCache = new Map<string, TranscriptFacts>()
const branchCache = new Map<string, { readAt: number; branch: string }>()
const lastStatus = new Map<string, string>()
let isScanning = false

// Without the session's own report, the window is the model's: these run with 1M tokens.
const MILLION_TOKEN_MODELS = /^claude-(fable-5|opus-5|opus-4-[6-9]|sonnet-5|sonnet-4-6|haiku-5)/

function contextWindowFor(model: string): number {
  return MILLION_TOKEN_MODELS.test(model) ? 1_000_000 : 200_000
}

function projectSlug(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

const STATUS_RANK: Record<string, number> = { waiting: 0, busy: 1, shell: 2, idle: 3 }

async function readTranscript(
  $: EngineInterface,
  home: string,
  registration: Registration,
  now: number,
): Promise<TranscriptFacts | undefined> {
  const cached = transcriptCache.get(registration.sessionId)
  if (cached && now - cached.readAt < TRANSCRIPT_POLL_MS) return cached

  const path = `${home}/.claude/projects/${projectSlug(registration.cwd)}/${registration.sessionId}.jsonl`
  // $.fs.read refuses files over 4 MiB, and long sessions pass that: read the tail.
  const tail = await $.process.run(['tail', '-c', TRANSCRIPT_TAIL_BYTES, path])
  if (tail.exitCode !== 0) return cached

  const lines = tail.stdout.split('\n')
  let model = ''
  let contextTokens = -1
  let lastPrompt = ''
  for (let index = lines.length - 1; index >= 1; index--) {
    const line = lines[index]
    if (!line || line[0] !== '{') continue
    let row: any
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    if (row.isSidechain) continue
    const message = row.message
    if (contextTokens < 0 && row.type === 'assistant' && message?.usage && message.model !== '<synthetic>') {
      const usage = message.usage
      model = String(message.model ?? '')
      contextTokens =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0)
    }
    if (!lastPrompt && row.type === 'user' && !row.isMeta && typeof message?.content === 'string') {
      const text = oneLine(message.content)
      if (text && !text.startsWith('<')) lastPrompt = text
    }
    if (contextTokens >= 0 && lastPrompt) break
  }

  const facts: TranscriptFacts = {
    readAt: now,
    model: model || cached?.model || '',
    contextTokens: contextTokens >= 0 ? contextTokens : cached?.contextTokens ?? 0,
    lastPrompt: lastPrompt || cached?.lastPrompt || '',
  }
  transcriptCache.set(registration.sessionId, facts)
  return facts
}

async function readBranch($: EngineInterface, cwd: string, now: number): Promise<string> {
  const cached = branchCache.get(cwd)
  if (cached && now - cached.readAt < TRANSCRIPT_POLL_MS) return cached.branch
  let branch = ''
  try {
    const result = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      timeoutMs: 5000,
    })
    if (result.exitCode === 0) branch = result.stdout.trim()
  } catch {
    branch = ''
  }
  branchCache.set(cwd, { readAt: now, branch })
  return branch
}

export async function scan($: EngineInterface): Promise<void> {
  if (isScanning) return
  isScanning = true
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    const now = await $.clock.now()
    const registryDir = `${home}/.claude/sessions`
    const entries = await $.fs.list(registryDir)

    const registrations: Registration[] = []
    for (const entry of entries) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const parsed = JSON.parse(await $.fs.read(`${registryDir}/${entry.name}`))
        if (typeof parsed.pid === 'number' && typeof parsed.sessionId === 'string') {
          registrations.push(parsed)
        }
      } catch {
        // A file mid-write: the next tick reads it.
      }
    }

    // The folder keeps files of sessions that died; ps says which are alive and on which tty.
    const ttyByPid = new Map<number, string>()
    if (registrations.length > 0) {
      const listing = await $.process.run([
        'ps',
        '-o',
        'pid=,tty=',
        '-p',
        registrations.map(registration => registration.pid).join(','),
      ])
      for (const line of listing.stdout.split('\n')) {
        const [pidText, tty] = line.trim().split(/\s+/)
        if (pidText && tty) ttyByPid.set(Number(pidText), tty)
      }
    }

    const selfId = await $.session.id()
    const roots = await readExcludedRoots($, home, now)
    const live = registrations.filter(
      registration => ttyByPid.has(registration.pid) && !isExcludedPath(roots, registration.cwd),
    )
    const sessions: FleetSession[] = await Promise.all(
      live.map(async registration => {
        const isSelf = registration.sessionId === selfId
        const [facts, branch] = await Promise.all([
          readTranscript($, home, registration, now),
          readBranch($, registration.cwd, now),
        ])
        let model = facts?.model ?? ''
        let contextTokens = facts?.contextTokens ?? 0
        let contextWindow = Math.max(contextWindowFor(model), contextTokens > 200_000 ? 1_000_000 : 0)
        if (isSelf) {
          const usage = await $.session.usage()
          model = await $.session.model()
          contextTokens = usage.context.tokens ?? contextTokens
          contextWindow = usage.context.window || contextWindow
        }
        const tty = ttyByPid.get(registration.pid) ?? ''
        return {
          sessionId: registration.sessionId,
          pid: registration.pid,
          tty: tty === '??' ? '' : tty,
          name: registration.name || baseName(registration.cwd),
          cwd: registration.cwd,
          folder: baseName(registration.cwd),
          branch,
          status: registration.status ?? '',
          waitingFor: registration.waitingFor ?? '',
          model,
          contextTokens,
          contextWindow,
          lastPrompt: facts?.lastPrompt ?? '',
          updatedAt: registration.updatedAt ?? 0,
          startedAt: registration.startedAt ?? 0,
          version: registration.version ?? '',
          isSelf,
        }
      }),
    )

    sessions.sort(
      (left, right) =>
        (STATUS_RANK[left.status] ?? 9) - (STATUS_RANK[right.status] ?? 9) ||
        right.updatedAt - left.updatedAt,
    )

    for (const session of sessions) {
      const before = lastStatus.get(session.sessionId)
      if (before && before !== 'waiting' && session.status === 'waiting' && !session.isSelf) {
        $.ui.toast(`${session.name} needs input`)
      }
      lastStatus.set(session.sessionId, session.status)
    }

    await writeSessions($, sessions)
    await writeScannedAt($, now)
  } finally {
    isScanning = false
  }
}
