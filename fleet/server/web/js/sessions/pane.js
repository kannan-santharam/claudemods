import { $ } from '../core/dom.js'
import { ago, esc, fmtCost, fmtTokens, markdown, shortModel } from '../core/format.js'
import { modelOptions } from '../core/models.js'
import { fieldValue, state } from '../core/state.js'
import { permissionCard, questionCard } from './asks.js'
import { screenHtml } from './screen.js'
import { lastDelivery, statusPill } from './tree.js'

// The last exchange as a chat: your prompt on the right, Claude's reply on the
// left, in the order they happened, and a typing bubble while it works.
function chatThread(s, id) {
  const messages = []
  if (s.lastPrompt) messages.push({ from: 'you', at: s.lastPromptAt, html: esc(s.lastPrompt) })
  if (s.lastReply) messages.push({ from: 'claude', at: s.lastReplyAt, html: markdown(s.lastReply) })
  messages.sort((first, second) => (first.at || 0) - (second.at || 0))
  const bubbles = messages.map(message => message.from === 'you'
    ? `<div class="msg you"><div class="bubble">${message.html}</div><div class="stamp">You${message.at ? ' · ' + ago(message.at) + ' ago' : ''}</div></div>`
    : `<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div><div class="bubble md" data-reply="${id}">${message.html}</div><div class="stamp">Claude${message.at ? ' · ' + ago(message.at) + ' ago' : ''}</div></div></div>`)
  if (s.status === 'busy') bubbles.push('<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="bubble typing" aria-label="Claude is working"><i></i><i></i><i></i></div></div>')
  const asks = s.asks || []
  for (const ask of asks) bubbles.push(`<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="ask-card">${ask.kind === 'question' ? questionCard(ask) : permissionCard(ask)}</div></div>`)
  if (s.status === 'waiting' && !asks.length) bubbles.push(`<div class="msg claude"><span class="avatar" aria-hidden="true">C</span><div class="bubble asking">Waiting for you${s.waitingFor ? ': ' + esc(s.waitingFor) : ''}${s.hidden ? '. Open Screen below to see what it shows.' : ''}</div></div>`)
  return bubbles.join('') || '<div class="stamp">No messages yet</div>'
}
// The selected session, docked on the right: who it is, what you can do to it,
// and its conversation, files, details or screen as tabs.
export function renderPane(byId, belowOf) {
  const pane = $('#session-pane')
  const s = byId.get([...state.open][0])
  pane.dataset.session = s ? s.sessionId : ''
  if (!s) { pane.innerHTML = '<div class="pane-empty">Pick a session to see its conversation here.</div>'; return }
  const id = esc(s.sessionId)
  const tab = state.paneTab[s.sessionId] || 'chat'
  const d = lastDelivery(s.sessionId)
  const files = s.filesTouched
  const filesHtml = files.map(f => `<div title="${esc(f.file)}">${esc(f.file.startsWith(s.cwd + '/') ? f.file.slice(s.cwd.length + 1) : f.file)}</div>`).join('')
  const opener = s.hidden
    ? `<button class="btn small" data-attach="${id}" title="Open it in a new terminal tab with claude attach ${esc(s.jobId)}; it keeps running hidden when you close that tab">Open in terminal ↗</button>`
    : s.tty
    ? `<button class="btn small" data-focus="${id}" title="Bring its terminal tab to the front">Open tab ↗</button>`
    : `<button class="btn small" disabled title="Runs without a terminal${s.launcher ? ', started by ' + esc(s.launcher) : ''}">No tab</button>`
  const tabButton = (key, label) => `<button type="button" role="tab" data-pane-tab="${key}" data-session="${id}" aria-selected="${tab === key}">${label}</button>`
  let content = ''
  if (tab === 'files') content = files.length ? `<div class="drawer files">${filesHtml}</div>` : '<div class="pane-empty">No files edited today.</div>'
  else if (tab === 'screen' && s.hidden) content = `<div class="drawer screen-drawer">${screenHtml(s)}</div>`
  else if (tab === 'details') content = `<dl class="drawer kv">
      <dt>Path</dt><dd><code>${esc(s.cwd)}</code></dd>
      <dt>Session id</dt><dd><code>${esc(s.sessionId)}</code></dd>
      ${s.hidden ? `<dt>Hidden</dt><dd>job <code>${esc(s.jobId)}</code> · <code>claude attach ${esc(s.jobId)}</code> opens it in a terminal · pid ${s.pid}</dd>` : `<dt>Terminal</dt><dd><code>${esc(s.tty || '—')}</code> · pid ${s.pid}</dd>`}
      ${s.branch ? `<dt>Branch</dt><dd><code>${esc(s.branch)}</code></dd>` : ''}
      <dt>Started</dt><dd>${s.startedAt ? new Date(s.startedAt).toLocaleString() + ' · ' + ago(s.startedAt) + ' ago' : '—'}</dd>
      ${s.sessionCostUsd != null ? `<dt>Session cost</dt><dd>${fmtCost(s.sessionCostUsd)} (as /cost reports it)</dd>` : ''}
      <dt>Today</dt><dd>${s.prompts} prompts · ${s.commits} commits · ${s.subagentCount} subagents · ${fmtTokens(s.todayTokens)} tokens · ${fmtCost(s.todayCost)}</dd>
      ${s.parentSessionId ? `<dt>Started by</dt><dd>${esc(byId.get(s.parentSessionId)?.name || s.parentSessionId)}${s.launcher ? ' via ' + esc(s.launcher) : ''}</dd>` : ''}
      <dt>Version</dt><dd>${esc(s.version || '—')}</dd>
    </dl>`
  else content = `<div class="thread">${chatThread(s, id)}</div>`
  pane.innerHTML = `
    <div class="pane-head">
      <div class="pane-title"><h2>${esc(s.name)}</h2>${statusPill(s, belowOf?.get(s.sessionId))}</div>
      <div class="pane-where"><span>${esc(s.folder)}</span><span>·</span><span>${esc(shortModel(s.model))}</span>${s.branch ? `<span>·</span><span>${esc(s.branch)}</span>` : ''}${s.hidden ? `<span class="tag hidden-tag">hidden</span><span class="sid" data-copy="${esc(s.jobId)}" title="Click to copy">${esc(s.jobId)}</span>` : ''}<span class="link ${s.hasMod ? 'on' : ''}">${s.hasMod ? 'connected' : 'not connected'}</span></div>
      <div class="pane-tools">
        ${opener}
        <button class="btn small" data-compact="${id}" title="Summarise the conversation so far to free up context (${s.contextPercent}% full)">Compact · ${s.contextPercent}%</button>
        <span class="spacer"></span>
        <div class="actions-menu">
          <button class="btn small" data-actions-menu="${id}" aria-expanded="${state.actionsMenu === s.sessionId}" aria-haspopup="true">Actions ▾</button>
          ${state.actionsMenu === s.sessionId ? `<div class="menu" role="menu">
            <label>Model<div class="row"><select data-field="model:${id}" aria-label="Model">${modelOptions(fieldValue('model:' + s.sessionId, s.model))}</select><button class="btn small" data-apply-model="${id}">Switch</button></div></label>
            <label>Name<div class="row"><input data-field="rename:${id}" maxlength="80" value="${esc(fieldValue('rename:' + s.sessionId, s.name))}" aria-label="Name"><button class="btn small" data-apply-rename="${id}">Rename</button></div></label>
            <button class="btn small item" data-copy="${esc(s.hidden ? s.jobId : s.sessionId)}">Copy ${s.hidden ? 'its id (' + esc(s.jobId) + ')' : 'session id'}</button>
            ${s.hidden ? `<button class="btn small item" data-copy="claude attach ${esc(s.jobId)}">Copy the attach command</button>` : ''}
          </div>` : ''}
        </div>
        <button class="btn small danger" data-end="${id}" title="Stop this Claude session and close its tab; its conversation is kept and can be resumed">End session</button>
      </div>
      <div class="pane-tabs" role="tablist" aria-label="Show">
        ${tabButton('chat', 'Chat')}${tabButton('files', `Files edited · ${files.length}`)}${tabButton('details', 'Details')}${s.hidden ? tabButton('screen', 'Screen') : ''}
      </div>
    </div>
    <div class="pane-body">${content}</div>
    ${tab === 'chat' ? `<div class="pane-foot">
      <div class="composer chat">
        <textarea rows="2" data-draft="${id}" placeholder="Message ${esc(s.name)} — Enter to send, Shift+Enter for a new line">${esc(state.drafts[s.sessionId] || '')}</textarea>
        <button class="btn primary" data-send="${id}" aria-label="Send">Send ➤</button>
      </div>
      ${d ? `<div class="delivery ${d.isDelivered ? 'good' : 'bad'}">${d.isDelivered ? '✓ Delivered' : '✕ Not delivered'} as a ${esc(d.via)} ${ago(d.at)} ago${d.reason ? ' — ' + esc(d.reason) : ''}: “${esc(d.text.slice(0, 90))}”</div>` : ''}
      ${s.hasMod ? '' : s.hidden ? '<div class="delivery bad">Not connected: a hidden session takes messages only through the Fleet mod, which has not reported in from it.</div>' : '<div class="delivery">Not connected: messages and commands are typed into its tab once it is idle.</div>'}
    </div>` : ''}`
}
