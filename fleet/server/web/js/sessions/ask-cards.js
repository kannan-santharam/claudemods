// The cards a session's permission prompts and questions draw in its chat,
// answered from there (asks.js). A session in a terminal asks there too, and
// its card says so: whichever is answered first counts. What was picked or
// typed is kept in state.fields, so the 2-second refresh keeps it.

import { escapeHtml, markdown, timeAgo } from '../core/format.js'
import { fieldValue } from '../core/state.js'

function askAge(ask) {
  return `${ask.inTerminal ? 'also in its terminal · ' : ''}${timeAgo(ask.createdAt)} ago`
}
function askSummary(ask) {
  const input = ask.toolInput || {}
  if (ask.toolName === 'Bash') return { text: input.command || '', note: input.description || '' }
  if (ask.toolName === 'ExitPlanMode') return { markdown: input.plan || '', note: 'Its plan, waiting for your approval' }
  if (input.file_path) return { text: input.file_path, note: ask.toolName === 'Edit' ? 'Edit this file' : ask.toolName === 'Write' ? 'Write this file' : '' }
  if (input.url) return { text: input.url, note: input.prompt || '' }
  if (input.pattern) return { text: input.pattern, note: input.path || '' }
  const text = JSON.stringify(input, null, 2)
  return { text: text === '{}' ? '' : text.length > 1500 ? text.slice(0, 1499) + '…' : text }
}
export function permissionCard(ask) {
  const summary = askSummary(ask)
  const isPlan = ask.toolName === 'ExitPlanMode'
  return `
    <div class="ask-head">${isPlan ? 'Approve this plan?' : `Allow ${escapeHtml(ask.toolName)}?`}<span>${escapeHtml(askAge(ask))}</span></div>
    ${summary.note || ask.reason ? `<div class="ask-note">${escapeHtml(summary.note || ask.reason)}</div>` : ''}
    ${summary.markdown ? `<div class="ask-plan md">${markdown(summary.markdown)}</div>` : summary.text ? `<pre class="ask-input">${escapeHtml(summary.text)}</pre>` : ''}
    <input class="ask-reason" data-field="ask:${escapeHtml(ask.id)}:message" maxlength="500" placeholder="${isPlan ? 'What to change (sent with Keep planning)' : 'Why not, or what to do instead (sent with Deny)'}" value="${escapeHtml(fieldValue('ask:' + ask.id + ':message', ''))}">
    <div class="ask-actions">
      <button class="btn small primary" data-ask-answer="${escapeHtml(ask.id)}" data-choice="allow">${isPlan ? 'Approve' : 'Allow'}</button>
      ${!isPlan ? `<button class="btn small" data-ask-answer="${escapeHtml(ask.id)}" data-choice="always" title="Allow this and every later ${escapeHtml(ask.toolName)} call until the session ends">Allow ${escapeHtml(ask.toolName)} for this session</button>` : ''}
      <button class="btn small danger" data-ask-answer="${escapeHtml(ask.id)}" data-choice="deny">${isPlan ? 'Keep planning' : 'Deny'}</button>
    </div>`
}
export function questionCard(ask) {
  const picked = index => { try { return JSON.parse(fieldValue(`ask:${ask.id}:${index}`, '[]')) } catch { return [] } }
  return `
    <div class="ask-head">${ask.questions.length > 1 ? `${ask.questions.length} questions for you` : 'A question for you'}<span>${escapeHtml(askAge(ask))}</span></div>
    ${ask.questions.map((question, index) => `
      <div class="ask-question">
        ${question.header ? `<div class="ask-chip">${escapeHtml(question.header)}</div>` : ''}
        <div class="ask-text">${escapeHtml(question.question)}${question.multiSelect ? ' <i>(pick any)</i>' : ''}</div>
        <div class="ask-options">${question.options.map(option => `
          <button type="button" class="ask-option" data-ask-pick="${escapeHtml(ask.id)}" data-question="${index}" data-label="${escapeHtml(option.label)}" data-multi="${question.multiSelect}" aria-pressed="${picked(index).includes(option.label)}">
            <b>${escapeHtml(option.label)}</b>${option.description ? `<span>${escapeHtml(option.description)}</span>` : ''}
          </button>`).join('')}
        </div>
        <input class="ask-reason" data-field="ask:${escapeHtml(ask.id)}:${index}:other" maxlength="2000" placeholder="Or type your own answer" value="${escapeHtml(fieldValue(`ask:${ask.id}:${index}:other`, ''))}">
      </div>`).join('')}
    <div class="ask-actions"><button class="btn small primary" data-ask-answer="${escapeHtml(ask.id)}" data-choice="submit">Send answer${ask.questions.length > 1 ? 's' : ''}</button></div>`
}
