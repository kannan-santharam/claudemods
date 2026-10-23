import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'fleet',
  component: 'Pane',
  requestId: 'fleet',
  props: {
    title: 'Fleet',
    isFocused: true,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SESSION = {
  sessionId: 'abc',
  pid: 42,
  tty: 'ttys013',
  name: 'api-review',
  cwd: '/work/my-app',
  folder: 'my-app',
  branch: 'master',
  status: 'waiting',
  waitingFor: 'input needed',
  model: 'claude-fable-5-1',
  contextTokens: 120000,
  contextWindow: 200000,
  lastPrompt: 'fix the tests',
  updatedAt: 1,
  startedAt: 1,
  version: '2.1.309',
  isSelf: false,
}

// What a scan stored, read back as the engine's state would answer it.
function seed(on: any, selected: string, sent: string[]) {
  on('clock.now', () => ({ value: 120_000 }))
  on('state.get', ($: unknown, e: any, next: any) => {
    if (e.key === 'sessions') {
      return { value: { value: { shape: 'sessions-1', value: [SESSION] }, version: 1 } }
    }
    if (e.key === 'selected') return { value: { value: selected, version: 1 } }
    return next(e)
  })
  // The dashboard server stands beneath: it answers health and takes the send.
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.read', () => ({ value: 'token' }))
  on('http.fetch', (_: unknown, e: any) => {
    if (String(e.url).endsWith('/api/send')) sent.push(JSON.parse(e.init.body).text)
    return { value: { status: 200, ok: true, headers: {}, text: '{"queued":1,"ok":true}' } }
  })
}

test('the pane lists a session with its status, branch, model and context', async ($, on) => {
  seed(on, '', [])
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /api-review/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /input needed/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /master/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /60% 120k/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a selected session shows its message box and sends to it', async ($, on) => {
  const sent: string[] = []
  seed(on, 'abc', sent)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ key: 'focus-abc' })).toBeDefined()
    await ui.input({ key: 'msg-abc', text: 'status?' })
    await ui.unmount()
  }
  expect(sent.length).toBe(2)
  expect(sent[0]).toBe('status?')
})
