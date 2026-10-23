export type FleetSession = {
  sessionId: string
  pid: number
  tty: string
  name: string
  cwd: string
  folder: string
  branch: string
  status: string
  waitingFor: string
  model: string
  contextTokens: number
  contextWindow: number
  lastPrompt: string
  updatedAt: number
  startedAt: number
  version: string
  isSelf: boolean
}

export type FleetSend = {
  to: string
  text: string
  isDelivered: boolean
  reason: string
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    fleet: {
      sessions: Shaped<FleetSession[]>
      lastSend: Shaped<FleetSend[]>
      selected: string
      isOpen: boolean
      scannedAt: number
    }
  }
}
