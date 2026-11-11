// Models: the colour each known model keeps everywhere, the aliases subagents
// report, and the options of a model picker.

import { cssVariable } from './dom.js'
import { escapeHtml, shortModel } from './format.js'
import { state } from './state.js'

// Color follows the model, never its rank: a fixed slot per known model; the rest fold into Other.
export const MODEL_SLOTS = ['claude-opus-5-5', 'claude-fable-5-1', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-haiku-5-5', 'claude-fable-5', 'claude-sonnet-5']
export function modelColor(model) {
  // A model newer than every slot of its family wears that family's colour
  // (shared with the one it replaces) rather than Other's grey; an older
  // unlisted one stays Other.
  const family = String(model).match(/^claude-[a-z]+-/)?.[0]
  const version = id => Number((id.match(/\d+/g) || []).slice(0, 2).join('.'))
  const newest = family ? MODEL_SLOTS.findIndex(slot => slot.startsWith(family)) : -1
  const index = MODEL_SLOTS.includes(model) || newest < 0 || version(model) <= version(MODEL_SLOTS[newest]) ? MODEL_SLOTS.indexOf(model) : newest
  return index < 0 ? cssVariable('--series-other') : cssVariable(`--series-${index + 1}`)
}
// A subagent's model is often an alias (fable, opus): the chip wants the
// model, which is the offered one of that family (the newest).
export function aliasedModel(model) {
  return (state.options?.models || []).find(option => option.id.startsWith(`claude-${model}-`))?.id || model
}
export function modelOptions(selected) {
  const models = (state.options?.models || []).filter(model => model.id)
  const known = models.some(model => model.id === selected)
  return (known ? '' : `<option value="" selected>${escapeHtml(shortModel(selected) || 'Choose a model')}</option>`) +
    models.map(model => `<option value="${escapeHtml(model.id)}" ${model.id === selected ? 'selected' : ''}>${escapeHtml(model.label)}</option>`).join('')
}
