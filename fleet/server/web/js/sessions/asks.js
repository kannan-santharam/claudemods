// Answering sessions' permission prompts and questions from the cards in
// their chat (ask-cards.js). What is picked or typed goes into
// state.fields until it is sent.

import { api } from '../core/api.js'
import { toast } from '../core/dom.js'
import { fieldValue, state } from '../core/state.js'
import { refreshLive } from '../refresh.js'
import { renderLive } from './live.js'

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
