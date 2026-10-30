import { expect, test } from 'claude-code/testing'

// A tool starting is reported with the fields a sentence is made from, and
// never with the command or a file's content.
test('a starting tool reaches the dashboard as its description, without the command', async ($, on) => {
  const reports: any[] = []
  on('session.id', () => ({ value: 'abc' }))
  on('clock.now', () => ({ value: 1000 }))
  on('session.cwd', () => ({ value: '/home/test/notes' }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.read', () => ({ value: 'token' }))
  on('http.fetch', (_: unknown, event: any) => {
    const route = String(event.url).replace(/^https?:\/\/[^/]+/, '').split('?')[0] ?? ''
    if (route === '/api/activity') reports.push(JSON.parse(event.init.body))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(route === '/api/asks/mode' ? { hidden: false, permissionMode: 'default' } : { ok: true }) } }
  })
  on('tool.check', () => ({ decision: 'allow' }))
  // The command itself, which does nothing here.
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  await $.tool.call({ tool: 'Bash', command: 'true', description: 'Count the notes' })
  for (let wait = 0; wait < 50 && !reports.length; wait++) await new Promise(resolve => (globalThis as any).setTimeout(resolve, 10))
  expect(reports).toEqual([{ sessionId: 'abc', tool: 'Bash', input: { description: 'Count the notes' } }])
})
