import { expect, test } from 'claude-code/testing'

const QUESTIONS = [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] }]

// The dashboard server beneath, for a session in a terminal. `answer` is what the
// page answers with, or undefined while nobody has answered there; a cancelled
// card ends its long poll as the server does. `cancelled` settles once the card
// is taken off, which happens after the call returns, without holding it up.
function dashboard(on: any, answer: unknown, calls: string[], permissionMode = 'default') {
  let endWait: (() => void) | undefined
  let markCancelled: () => void = () => {}
  const cancelled = new Promise<void>(resolve => { markCancelled = resolve })
  on('session.id', () => ({ value: 'abc' }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.read', () => ({ value: 'token' }))
  on('http.fetch', async (_: unknown, event: any) => {
    const route = String(event.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    calls.push(route)
    const reply = (body: unknown) => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } })
    if (route === '/api/asks/mode') return reply({ hidden: false, permissionMode })
    if (route === '/api/asks') return reply({ ok: true, id: 'ask-1', inTerminal: JSON.parse(event.init.body).inTerminal })
    if (route === '/api/asks/cancel') {
      endWait?.()
      markCancelled()
      return reply({ ok: true })
    }
    if (route === '/api/asks/wait') {
      if (answer) return reply({ status: 'answered', answer })
      await new Promise<void>(resolve => { endWait = resolve })
      return reply({ status: 'gone' })
    }
    return reply({ ok: true })
  })
  return { cancelled }
}

test('a question answered on the page closes the terminal dialog with that answer', async ($, on) => {
  const calls: string[] = []
  dashboard(on, { answers: { 'Which colour?': 'Blue' } }, calls)
  // The terminal's dialog, which nobody answers.
  on('tool.call', { tool: 'AskUserQuestion' }, () => new Promise(() => {}))
  const answered: any = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
  expect(answered.result.answers).toEqual({ 'Which colour?': 'Blue' })
  expect(calls.includes('/api/asks')).toBe(true)
})

test('a question answered in the terminal takes its card off the page', async ($, on) => {
  const calls: string[] = []
  const server = dashboard(on, undefined, calls)
  on('tool.call', { tool: 'AskUserQuestion' }, () => ({ result: { questions: QUESTIONS, answers: { 'Which colour?': 'Red' } } }))
  const answered: any = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
  expect(answered.result.answers).toEqual({ 'Which colour?': 'Red' })
  await server.cancelled
  expect(calls.includes('/api/asks/cancel')).toBe(true)
})

test('a permission prompt denied on the page closes the terminal dialog with a deny', async ($, on) => {
  const calls: string[] = []
  dashboard(on, { allow: false, remember: false, message: 'Not now' }, calls)
  on('tool.check', () => ({ decision: 'ask' }))
  // The person at the terminal, who has not answered yet.
  on('classic.PermissionRequest', () => new Promise(() => {}))
  const outcome: any = await $.tool.call({ tool: 'Bash', command: 'true' }).catch((error: unknown) => ({ rejected: String(error) }))
  expect(JSON.stringify(outcome)).toContain('Not now')
  expect(calls.includes('/api/asks')).toBe(true)
})

test('a permission prompt answered in the terminal takes its card off the page', async ($, on) => {
  const calls: string[] = []
  const server = dashboard(on, undefined, calls)
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'deny', message: 'No from the terminal' } }))
  const outcome: any = await $.tool.call({ tool: 'Bash', command: 'true' }).catch((error: unknown) => ({ rejected: String(error) }))
  expect(JSON.stringify(outcome)).toContain('No from the terminal')
  await server.cancelled
  expect(calls.includes('/api/asks/cancel')).toBe(true)
})

test('an ask auto mode settles never reaches the page', async ($, on) => {
  const calls: string[] = []
  dashboard(on, undefined, calls, 'auto')
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'allow' } }))
  await $.tool.call({ tool: 'Bash', command: 'true' }).catch(() => undefined)
  expect(calls.includes('/api/asks')).toBe(false)
})
