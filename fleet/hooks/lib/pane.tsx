// The /fleet pane in the terminal: one row per running session, from what the
// scan stored, with a message box and a jump to its tab for the selected one.

import type { EngineInterface, MatchedHook } from 'claude-code'

import type { FleetSession } from '../../types'
import { fitToWidth, meter, shortTokens, timeAgo } from './format'
import { sendTo } from './messages'
import { scan } from './scan'
import { openBrowserDashboard } from './server'
import { readLastSend, readScannedAt, readSelected, readSessions, updateSelected, writeIsOpen } from './state'
import { focusTab } from './terminal'

export const PANE = 'fleet'

function statusLook(session: FleetSession): { mark: string; label: string; color: string } {
  switch (session.status) {
    case 'waiting':
      return { mark: '◆', label: session.waitingFor || 'needs input', color: 'error' }
    case 'busy':
      return { mark: '●', label: 'working', color: 'warning' }
    case 'shell':
      return { mark: '$', label: 'shell', color: 'suggestion' }
    case 'idle':
      return { mark: '○', label: 'idle', color: 'success' }
    default:
      return { mark: '·', label: session.status || 'unknown', color: 'inactive' }
  }
}

export async function openPane($: EngineInterface): Promise<void> {
  await writeIsOpen($, true)
  void scan($)
  await $.ui.open({ id: PANE, title: 'Fleet', focus: true, columns: 72 })
}

export const markPaneClosed: MatchedHook<'ui.close', { id: typeof PANE }> = async ($, event, next) => {
  await writeIsOpen($, false)
  return next(event)
}

export const renderPane: MatchedHook<'ui.render', { component: 'Pane'; requestId: typeof PANE }> = async ($, event) => {
  const table = $.ui.resolve(event)
  const { Box, Text, Button } = table
  // The mobile surface draws no text field: it reads and focuses only.
  const Input = 'Input' in table ? table.Input : undefined
  const sessions = await readSessions($)
  const selected = await readSelected($)
  const sends = await readLastSend($)
  const scannedAt = await readScannedAt($)
  const now = await $.clock.now()
  const width = Math.max(24, event.props.bodyColumns)

  const counts = { waiting: 0, busy: 0, idle: 0 }
  for (const session of sessions) {
    if (session.status === 'waiting') counts.waiting++
    else if (session.status === 'busy') counts.busy++
    else counts.idle++
  }
  const failures = sends.filter(send => !send.isDelivered)

  return (
    <Box flexDirection="column">
      <Text>
        <Text weight="bold">{sessions.length} sessions</Text>
        <Text dimColor> · </Text>
        <Text color="error">{counts.waiting} waiting</Text>
        <Text dimColor> · </Text>
        <Text color="warning">{counts.busy} working</Text>
        <Text dimColor> · </Text>
        <Text color="success">{counts.idle} idle</Text>
        <Text dimColor>{scannedAt ? `  ${timeAgo(now, scannedAt)} ago` : '  scanning…'}</Text>
      </Text>
      <Box flexDirection="row" gap={1}>
        <Button
          key="open-web"
          label="Open browser dashboard"
          hotkey="o"
          onPress={async () => $.ui.toast(await openBrowserDashboard($))}
        />
      </Box>
      <Text> </Text>
      {sessions.map(session => {
        const look = statusLook(session)
        const isSelected = session.sessionId === selected
        const percent = session.contextWindow
          ? Math.round((session.contextTokens / session.contextWindow) * 100)
          : 0
        const contextColor = percent >= 70 ? 'error' : percent >= 50 ? 'warning' : 'inactive'
        const meta = [
          session.folder,
          session.branch && `⎇ ${session.branch}`,
          session.model.replace(/^claude-/, ''),
        ]
          .filter(Boolean)
          .join(' · ')
        return (
          <Box flexDirection="column" marginBottom={isSelected ? 1 : 0}>
            <Button
              key={`row-${session.sessionId}`}
              plain
              onPress={async () => {
                await updateSelected($, current =>
                  current === session.sessionId ? '' : session.sessionId,
                )
                if (!session.isSelf) {
                  // Best effort: the box is drawn by the redraw this write starts.
                  void $.ui
                    .focus({ requestId: PANE, key: `msg-${session.sessionId}` })
                    .catch(() => undefined)
                }
              }}
            >
              <Text color={look.color}>{look.mark}</Text>{' '}
              <Text weight={isSelected ? 'bold' : 'regular'}>
                {fitToWidth(session.name, Math.max(8, width - 26))}
              </Text>
              {session.isSelf ? <Text dimColor> (this)</Text> : ''}
              <Text color={look.color}> {look.label}</Text>
              <Text dimColor> {timeAgo(now, session.updatedAt)}</Text>
            </Button>
            <Text dimColor wrap="truncate-end">
              {'  '}
              {fitToWidth(meta, Math.max(8, width - 18))}
              {'  '}
              <Text color={contextColor}>
                ctx {meter(percent, 8)} {percent}% {shortTokens(session.contextTokens)}
              </Text>
            </Text>
            {isSelected && (
              <Box flexDirection="column" paddingLeft={2} marginTop={1}>
                <Text dimColor wrap="truncate-end">
                  {session.cwd}
                </Text>
                <Text dimColor>
                  pid {session.pid} · {session.tty || 'no tty'} · v{session.version} · up{' '}
                  {timeAgo(now, session.startedAt)}
                </Text>
                {session.lastPrompt && (
                  <Text wrap="truncate-end">
                    <Text dimColor>last: </Text>
                    {fitToWidth(session.lastPrompt, width * 2)}
                  </Text>
                )}
                <Box flexDirection="row" gap={1} marginTop={1}>
                  <Button
                    key={`focus-${session.sessionId}`}
                    label="Go to tab"
                    hotkey="g"
                    variant="primary"
                    onPress={() => focusTab($, session)}
                  />
                  <Button
                    key={`close-${session.sessionId}`}
                    label="Close"
                    hotkey="x"
                    onPress={() => updateSelected($, () => '')}
                  />
                </Box>
                {session.isSelf ? (
                  <Text dimColor>This is the dashboard's own session.</Text>
                ) : (
                  Input && (
                  <Input
                    key={`msg-${session.sessionId}`}
                    label="› "
                    placeholder={`Message ${session.name}…`}
                    submitLabel="send"
                    autoFocus
                    onSubmit={(text: string) => sendTo($, [session], text)}
                  />
                  )
                )}
              </Box>
            )}
          </Box>
        )
      })}
      {sessions.length === 0 && <Text dimColor>No running sessions found.</Text>}
      {failures.map(failure => (
        <Text color="error" wrap="truncate-end">
          {failure.to}: {failure.reason}
        </Text>
      ))}
    </Box>
  )
}
