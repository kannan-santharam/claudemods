// Permission prompts and questions from hidden sessions, shown as cards in
// their chat and answered from there.

import { api } from '../core/api.js'
import { toast } from '../core/dom.js'
import { escapeHtml, markdown, timeAgo } from '../core/format.js'
import { fieldValue, state } from '../core/state.js'
import { refreshLive } from '../refresh.js'
import { renderLive } from './live.js'

// A hidden session's permission prompts and questions, answered from its chat.
// What was picked or typed is kept in state.fields, so the 2-second refresh keeps it.
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
    <div class="ask-head">${isPlan ? 'Approve this plan?' : `Allow ${escapeHtml(ask.toolName)}?`}<span>${escapeHtml(timeAgo(ask.createdAt))} ago</span></div>
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
    <div class="ask-head">${ask.questions.length > 1 ? `${ask.questions.length} questions for you` : 'A question for you'}<span>${escapeHtml(timeAgo(ask.createdAt))} ago</span></div>
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
export async function answerAsk(askId, choice) {
  const ask = (state.live?.sessions || []).flatMap(session => session.asks || []).find(item => item.id === askId)
  if (!ask) return toast('That question is no longer open')
  let answer
  if (ask.kind === 'permission') {
    answer = { allow: choice !== 'deny', remember: choice === 'always', message: fieldValue(`ask:${askId}:message`, '') }
  } else {
    const answers = {}
    ask.questions.forEach((question, index) => {
      let labels = []
      try { labels = JSON.parse(fieldValue(`ask:${askId}:${index}`, '[]')) } catch {}
      const other = fieldValue(`ask:${askId}:${index}:other`, '').trim()
      const value = [...labels, ...(other ? [other] : [])].join(', ')
      if (value) answers[question.question] = value
    })
    if (Object.keys(answers).length < ask.questions.length) return toast(ask.questions.length > 1 ? 'Answer every question first' : 'Pick an answer first')
    answer = { answers }
  }
  try {
    const result = await api('/api/asks/answer', { id: askId, answer })
    if (!result.ok) return toast(result.reason)
    for (const key of Object.keys(state.fields)) if (key.startsWith(`ask:${askId}:`)) delete state.fields[key]
    toast(ask.kind === 'question' ? 'Answer sent' : choice === 'deny' ? 'Declined' : 'Allowed')
    refreshLive()
  } catch (error) { toast(error.message) }
}
export function pickOption(button) {
  const key = `ask:${button.dataset.askPick}:${button.dataset.question}`
  let labels = []
  try { labels = JSON.parse(fieldValue(key, '[]')) } catch {}
  const label = button.dataset.label
  if (button.dataset.multi === 'true') labels = labels.includes(label) ? labels.filter(item => item !== label) : [...labels, label]
  else labels = labels.includes(label) ? [] : [label]
  state.fields[key] = JSON.stringify(labels)
  renderLive()
}
