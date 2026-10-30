// The selected session's pane: its header and tools, and the chat, files,
// details or screen below.

import { $ } from '../core/dom.js'
import { escapeHtml, formatCost, formatTokens, shortModel, timeAgo } from '../core/format.js'
import { modelOptions } from '../core/models.js'
import { fieldValue, state } from '../core/state.js'
import { permissionCard, questionCard } from './ask-cards.js'
import { conversationHtml, messageBubble } from './conversation.js'
import { screenHtml } from './screen.js'
import { lastDelivery, statusPill } from './tree.js'

// The conversation as a chat, read from the transcript as it is scrolled; until
// that arrives, the last exchange the live view carries. Then a typing bubble
// while it works, and any question it is waiting on.
function chatThread(session, id) {
  const lastExchange = () => {
    const messages = []
    if (session.lastPrompt) messages.push({ from: 'you', at: session.lastPromptAt, text: session.lastPrompt })
    if (session.lastReply) messages.push({ from: 'claude', at: session.lastReplyAt, text: session.lastReply })
    messages.sort((first, second) => (first.at || 0) - (second.at || 0))
    return messages.map(message => messageBubble(message, session.sessionId)).join('')
  }
  const bubbles = [conversationHtml(session, id) ?? lastExchange()].filter(Boolean)
  if (session.status === 'busy') bubbles.push('<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="bubble typing" aria-label="Claude is working"><i></i><i></i><i></i></div></div>')
  const asks = session.asks || []
  for (const ask of asks) bubbles.push(`<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="ask-card">${ask.kind === 'question' ? questionCard(ask) : permissionCard(ask)}</div></div>`)
  if (session.status === 'waiting' && !asks.length) bubbles.push(`<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="bubble asking">Waiting for you${session.waitingFor ? ': ' + escapeHtml(session.waitingFor) : ''}${session.hidden ? '. Open Screen below to see what it shows.' : ''}</div></div>`)
  return bubbles.join('') || '<div class="stamp">No messages yet</div>'
}
// The selected session, docked on the right: who it is, what you can do to it,
// and its conversation, files, details or screen as tabs.
export function renderPane(byId, belowOf) {
  const pane = $('#session-pane')
  const session = byId.get([...state.open][0])
  pane.dataset.session = session ? session.sessionId : ''
  if (!session) { pane.innerHTML = '<div class="pane-empty">Pick a session to see its conversation here.</div>'; return }
  const id = escapeHtml(session.sessionId)
  const tab = state.paneTab[session.sessionId] || 'chat'
  const delivery = lastDelivery(session.sessionId)
  const files = session.filesTouched
  const filesHtml = files.map(touched => `<div title="${escapeHtml(touched.file)}">${escapeHtml(touched.file.startsWith(session.cwd + '/') ? touched.file.slice(session.cwd.length + 1) : touched.file)}</div>`).join('')
  const opener = session.hidden
    ? `<button class="btn small" data-attach="${id}" title="Open it in a new terminal tab with claude attach ${escapeHtml(session.jobId)}; it keeps running hidden when you close that tab">Open in terminal ↗</button>`
    : session.tty
    ? `<button class="btn small" data-focus="${id}" title="Bring its terminal tab to the front">Open tab ↗</button>`
    : `<button class="btn small" disabled title="Runs without a terminal${session.launcher ? ', started by ' + escapeHtml(session.launcher) : ''}">No tab</button>`
  const tabButton = (key, label) => `<button type="button" role="tab" data-pane-tab="${key}" data-session="${id}" aria-selected="${tab === key}">${label}</button>`
  let content = ''
  if (tab === 'files') content = files.length ? `<div class="drawer files">${filesHtml}</div>` : '<div class="pane-empty">No files edited today.</div>'
  else if (tab === 'screen' && session.hidden) content = `<div class="drawer screen-drawer">${screenHtml(session)}</div>`
  else if (tab === 'details') content = `<dl class="drawer kv">
      <dt>Path</dt><dd><code>${escapeHtml(session.cwd)}</code></dd>
      <dt>Session id</dt><dd><code>${escapeHtml(session.sessionId)}</code></dd>
      ${session.hidden ? `<dt>Hidden</dt><dd>job <code>${escapeHtml(session.jobId)}</code> · <code>claude attach ${escapeHtml(session.jobId)}</code> opens it in a terminal · pid ${session.pid}</dd>` : `<dt>Terminal</dt><dd><code>${escapeHtml(session.tty || '—')}</code> · pid ${session.pid}</dd>`}
      ${session.branch ? `<dt>Branch</dt><dd><code>${escapeHtml(session.branch)}</code></dd>` : ''}
      <dt>Started</dt><dd>${session.startedAt ? new Date(session.startedAt).toLocaleString() + ' · ' + timeAgo(session.startedAt) + ' ago' : '—'}</dd>
      ${session.sessionCostUsd != null ? `<dt>Session cost</dt><dd>${formatCost(session.sessionCostUsd)} (as /cost reports it)</dd>` : ''}
      <dt>Today</dt><dd>${session.prompts} prompts · ${session.commits} commits · ${session.subagentCount} subagents · ${formatTokens(session.todayTokens)} tokens · ${formatCost(session.todayCost)}</dd>
      ${session.parentSessionId ? `<dt>Started by</dt><dd>${escapeHtml(byId.get(session.parentSessionId)?.name || session.parentSessionId)}${session.launcher ? ' via ' + escapeHtml(session.launcher) : ''}</dd>` : ''}
      <dt>Version</dt><dd>${escapeHtml(session.version || '—')}</dd>
    </dl>`
  else content = `<div class="thread">${chatThread(session, id)}</div>`
  pane.innerHTML = `
    <div class="pane-head">
      <div class="pane-title"><h2>${escapeHtml(session.name)}</h2>${statusPill(session, belowOf?.get(session.sessionId))}</div>
      <div class="pane-where"><span>${escapeHtml(session.folder)}</span><span>·</span><span>${escapeHtml(shortModel(session.model))}</span>${session.branch ? `<span>·</span><span>${escapeHtml(session.branch)}</span>` : ''}${session.hidden ? `<span class="tag hidden-tag">hidden</span><span class="sid" data-copy="${escapeHtml(session.jobId)}" title="Click to copy">${escapeHtml(session.jobId)}</span>` : ''}<span class="link ${session.hasMod ? 'on' : ''}">${session.hasMod ? 'connected' : 'not connected'}</span></div>
      <div class="pane-tools">
        ${opener}
        <button class="btn small" data-compact="${id}" title="Summarise the conversation so far to free up context (${session.contextPercent}% full)">Compact · ${session.contextPercent}%</button>
        <span class="spacer"></span>
        <div class="actions-menu">
          <button class="btn small" data-actions-menu="${id}" aria-expanded="${state.actionsMenu === session.sessionId}" aria-haspopup="true">Actions ▾</button>
          ${state.actionsMenu === session.sessionId ? `<div class="menu" role="menu">
            <label>Model<div class="row"><select data-field="model:${id}" aria-label="Model">${modelOptions(fieldValue('model:' + session.sessionId, session.model))}</select><button class="btn small" data-apply-model="${id}">Switch</button></div></label>
            <label>Name<div class="row"><input data-field="rename:${id}" maxlength="80" value="${escapeHtml(fieldValue('rename:' + session.sessionId, session.name))}" aria-label="Name"><button class="btn small" data-apply-rename="${id}">Rename</button></div></label>
            <button class="btn small item" data-copy="${escapeHtml(session.hidden ? session.jobId : session.sessionId)}">Copy ${session.hidden ? 'its id (' + escapeHtml(session.jobId) + ')' : 'session id'}</button>
            ${session.hidden ? `<button class="btn small item" data-copy="claude attach ${escapeHtml(session.jobId)}">Copy the attach command</button>` : ''}
          </div>` : ''}
        </div>
        <button class="btn small danger" data-end="${id}" title="Stop this Claude session and close its tab; its conversation is kept and can be resumed">End session</button>
      </div>
      <div class="pane-tabs" role="tablist" aria-label="Show">
        ${tabButton('chat', 'Chat')}${tabButton('files', `Files edited · ${files.length}`)}${tabButton('details', 'Details')}${session.hidden ? tabButton('screen', 'Screen') : ''}
      </div>
    </div>
    <div class="pane-body">${content}</div>
    ${tab === 'chat' ? `<div class="pane-foot">
      <div class="composer chat">
        <textarea rows="2" data-draft="${id}" placeholder="Message ${escapeHtml(session.name)} — Enter to send, Shift+Enter for a new line">${escapeHtml(state.drafts[session.sessionId] || '')}</textarea>
        <button class="btn primary" data-send="${id}" aria-label="Send">Send ➤</button>
      </div>
      ${delivery ? `<div class="delivery ${delivery.isDelivered ? 'good' : 'bad'}">${delivery.isDelivered ? '✓ Delivered' : '✕ Not delivered'} as a ${escapeHtml(delivery.via)} ${timeAgo(delivery.at)} ago${delivery.reason ? ' — ' + escapeHtml(delivery.reason) : ''}: “${escapeHtml(delivery.text.slice(0, 90))}”</div>` : ''}
      ${session.hasMod ? '' : session.hidden ? '<div class="delivery bad">Not connected: a hidden session takes messages only through the Fleet mod, which has not reported in from it.</div>' : '<div class="delivery">Not connected: messages and commands are typed into its tab once it is idle.</div>'}
    </div>` : ''}`
}
