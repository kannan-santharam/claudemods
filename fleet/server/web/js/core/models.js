// Models: the colour each known model keeps everywhere, the aliases subagents
// report, and the options of a model picker.

import { css } from './dom.js'
import { esc, shortModel } from './format.js'
import { state } from './state.js'

// Color follows the model, never its rank: a fixed slot per known model; the rest fold into Other.
export const MODEL_SLOTS = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-haiku-5-5', 'claude-fable-5', 'claude-sonnet-5']
export function modelColor(model) {
  const index = MODEL_SLOTS.indexOf(model)
  return index < 0 ? css('--series-other') : css(`--series-${index + 1}`)
}
// A subagent's model is often an alias (fable, opus): the chip wants the model.
export const MODEL_ALIASES = { fable: 'claude-fable-5-1', opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' }
export function modelOptions(selected) {
  const models = (state.options?.models || []).filter(m => m.id)
  const known = models.some(m => m.id === selected)
  return (known ? '' : `<option value="" selected>${esc(shortModel(selected) || 'Choose a model')}</option>`) +
    models.map(m => `<option value="${esc(m.id)}" ${m.id === selected ? 'selected' : ''}>${esc(m.label)}</option>`).join('')
}
