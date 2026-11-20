import { expect, test } from 'claude-code/testing'

const wait = (milliseconds: number) => new Promise(resolve => (globalThis as any).setTimeout(resolve, milliseconds))

// The dashboard's side of a stop: `answers` are what its long poll says, in order.
function dashboard(on: any, answers: Array<{ stop: boolean; afterMs?: number }>) {
  const calls = { waits: 0, aborted: [] as string[], released: [] as string[] }
  on('session.id', () => ({ value: 'abc' }))
  on('clock.now', () => ({ value: 1000 }))
  on('clock.sleep', () => ({ value: undefined }))
  on('session.cwd', () => ({ value: '/home/test/notes' }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.read', () => ({ value: 'token' }))
  on('http.fetch', async (_: unknown, event: any) => {
    const route = String(event.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    let body: unknown = { ok: true }
    if (route === '/api/stop/release') calls.released.push(JSON.parse(event.init.body).sessionId)
    if (route === '/api/stop/wait') {
      calls.waits++
      // Out of answers: the poll stays open, as the server holds it.
      if (!answers.length) await wait(10_000)
      const answer = answers.shift()
      if (answer?.afterMs) await wait(answer.afterMs)
      body = { stop: Boolean(answer?.stop) }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } }
  })
  on('turn.abort', (_: unknown, event: any) => {
    calls.aborted.push(event.turnId)
    return { value: undefined }
  })
  on('turn.start', (_: unknown, event: any) => ({ turnId: event.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return calls
}

test('a stop asked on the dashboard cancels the running turn', async ($, on) => {
  const calls = dashboard(on, [{ stop: false }, { stop: true }])
  await $.turn.start({ turnId: 'turn-1', text: 'hello' } as any)
  for (let tries = 0; tries < 50 && !calls.aborted.length; tries++) await wait(10)
  expect(calls.aborted).toEqual(['turn-1'])
  // The first answer said no stop; it asked again and got one.
  expect(calls.waits >= 2).toBe(true)
})

test('a turn that has ended lets its request go, and a subagent is never watched', async ($, on) => {
  const calls = dashboard(on, [])
  await $.turn.start({ turnId: 'helper-1', text: 'hello', agentId: 'a1' } as any)
  await wait(30)
  expect(calls.waits).toBe(0)
  await $.turn.start({ turnId: 'turn-2', text: 'hello' } as any)
  await wait(30)
  expect(calls.waits).toBe(1)
  await $.turn.complete({ turnId: 'turn-2', answer: '', durationMs: 1, isAborted: false, reason: 'answer' } as any)
  for (let tries = 0; tries < 50 && !calls.released.length; tries++) await wait(10)
  expect(calls.released).toEqual(['abc'])
  expect(calls.aborted).toEqual([])
})

test('a stop that was waiting for the turn cancels it as it starts', async ($, on) => {
  const calls = dashboard(on, [{ stop: true }])
  await $.turn.start({ turnId: 'turn-4', text: 'sent from the page' } as any)
  for (let tries = 0; tries < 50 && !calls.aborted.length; tries++) await wait(10)
  expect(calls.aborted).toEqual(['turn-4'])
})
