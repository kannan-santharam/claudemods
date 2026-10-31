import { expect, test } from 'claude-code/testing'

const QUESTIONS = [{ question: 'Which colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red', description: '' }, { label: 'Blue', description: '' }] }]

// The dashboard server beneath, for a session in a terminal (or a hidden one). `answer` is what the
// page answers with, or undefined while nobody has answered there; a cancelled
// card ends its long poll as the server does. `cancelled` settles once the card
// is taken off, which happens after the call returns, without holding it up.
function dashboard(on: any, answer: unknown, calls: string[], permissionMode = 'default', hidden = false, posted: any[] = []) {
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
    if (route === '/api/asks/mode') return reply({ hidden, permissionMode })
    if (route === '/api/asks') {
      posted.push(JSON.parse(event.init.body))
      return reply({ ok: true, id: 'ask-1', inTerminal: JSON.parse(event.init.body).inTerminal })
    }
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
  // The classifier's allow, which opens no dialog.
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'true' }).catch(() => undefined)
  expect(calls.includes('/api/asks')).toBe(false)
})

test('an ask auto mode hands to the person gets a card the server holds until the dialog opens', async ($, on) => {
  const calls: string[] = []
  const posted: any[] = []
  dashboard(on, { allow: false, remember: false, message: 'Not from auto mode' }, calls, 'auto', false, posted)
  on('tool.check', () => ({ decision: 'ask' }))
  // The dialog the classifier opened, which nobody at the terminal answers.
  on('classic.PermissionRequest', () => new Promise(() => {}))
  const outcome: any = await $.tool.call({ tool: 'Bash', command: 'true' }).catch((error: unknown) => ({ rejected: String(error) }))
  expect(JSON.stringify(outcome)).toContain('Not from auto mode')
  expect(posted[0]?.whenWaiting).toBe(true)
})

test('a hidden session asks the page alone, as before', async ($, on) => {
  const calls: string[] = []
  dashboard(on, { answers: { 'Which colour?': 'Blue' } }, calls, 'default', true)
  // A hidden session has no dialog to open: reaching it would be a regression.
  let reachedDialog = false
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    reachedDialog = true
    return new Promise(() => {})
  })
  const answered: any = await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
  expect(answered.result.answers).toEqual({ 'Which colour?': 'Blue' })
  expect(reachedDialog).toBe(false)
})

test('a hidden session allows a tool from the page, as before', async ($, on) => {
  const calls: string[] = []
  dashboard(on, { allow: true, remember: false, message: '' }, calls, 'default', true)
  on('tool.check', () => ({ decision: 'ask' }))
  on('classic.PermissionRequest', () => ({ decision: { behavior: 'deny', message: 'The page was not asked' } }))
  const verdict = await $.tool.check({ tool: 'Bash', input: { command: 'true' } })
  // A query carries no tool_use_id, so it is left as it was; a real call is answered by the page.
  expect(verdict.decision).toBe('ask')
  const outcome: any = await $.tool.call({ tool: 'Bash', command: 'true' }).catch((error: unknown) => ({ rejected: String(error) }))
  expect(JSON.stringify(outcome)).not.toContain('The page was not asked')
  expect(calls.includes('/api/asks')).toBe(true)
})
