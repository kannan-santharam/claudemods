import { expect, test } from 'claude-code/testing'

const wait = (milliseconds: number) => new Promise(resolve => (globalThis as any).setTimeout(resolve, milliseconds))

// What the dashboard is sent of a reply, with the model's stream stood in for.
function dashboard(on: any, pieces: any[], isUp = true) {
  const reports: any[] = []
  on('session.id', () => ({ value: 'abc' }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/home/test/notes' }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.read', () => ({ value: 'token' }))
  on('http.fetch', (_: unknown, event: any) => {
    const route = String(event.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    if (route === '/api/stream') reports.push(JSON.parse(event.init.body))
    if (!isUp) throw new Error('connection refused')
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ ok: true }) } }
  })
  on('turn.step', async function* (_: unknown, event: any) {
    for (const piece of pieces) yield piece
    return { turnId: event.turnId, index: event.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  return reports
}
const step = { turnId: 'turn-1', index: 0, model: 'opus', messageCount: 1 }
const read = async (stream: AsyncIterable<unknown>) => {
  const seen: unknown[] = []
  for await (const chunk of stream) seen.push(chunk)
  return seen
}

test('a reply reaches the terminal untouched and the dashboard as it grows', async ($, on) => {
  const pieces = [
    { kind: 'thinking', index: 0, text: 'Not for the dashboard' },
    { kind: 'text', index: 1, text: 'Hello' },
    { kind: 'text', index: 1, text: ' there' },
    { kind: 'stop', stopReason: 'end_turn', usage: null },
  ]
  const reports = dashboard(on, pieces)
  expect(await read($.turn.step(step as any))).toEqual(pieces)
  for (let tries = 0; tries < 50 && !reports.at(-1)?.isDone; tries++) await wait(10)
  expect(reports.at(-1)).toEqual({ sessionId: 'abc', id: 'turn-1:0', text: 'Hello there', isDone: true })
  expect(reports.every(report => 'Hello there'.startsWith(report.text))).toBe(true)
})

test("a subagent's reply is not reported", async ($, on) => {
  const pieces = [{ kind: 'text', index: 0, text: 'From a helper' }]
  const reports = dashboard(on, pieces)
  expect(await read($.turn.step({ ...step, agentId: 'a1' } as any))).toEqual(pieces)
  await wait(30)
  expect(reports).toEqual([])
})

test('a dashboard that is down is tried once and the reply is untouched', async ($, on) => {
  const pieces = [{ kind: 'text', index: 0, text: 'Hel' }, { kind: 'text', index: 0, text: 'lo' }]
  const reports = dashboard(on, pieces, false)
  expect(await read($.turn.step(step as any))).toEqual(pieces)
  await wait(30)
  expect(reports.length).toBe(1)
})
