import { toast } from '../core/dom.js'
import { remembered } from '../core/storage.js'

// Where a new or resumed session runs: a terminal tab, or hidden (`claude --bg`).
export const runMode = () => (remembered('fleet-run-mode') === 'hidden' ? 'hidden' : 'tab')
export function showRunMode(group) { document.querySelectorAll(`input[name="${group}"]`).forEach(input => { input.checked = input.value === runMode() }) }
export function startedToast(result, verb) {
  if (result.where === 'hidden') return toast(`${verb} hidden as ${result.jobId}. It appears here in a few seconds, and claude attach ${result.jobId} opens it in a terminal if you ever want to.`)
  toast(`${verb} in a new ${result.where === 'tab' ? 'tab' : 'window'} — it appears here in a few seconds${result.hint ? '. ' + result.hint : ''}`)
}
