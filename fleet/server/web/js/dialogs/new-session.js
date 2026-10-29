import { api } from '../core/api.js'
import { $, toast } from '../core/dom.js'
import { esc } from '../core/format.js'
import { state } from '../core/state.js'
import { remember, remembered } from '../core/storage.js'
import { createPicker, rememberFolder } from './picker.js'
import { runMode, showRunMode, startedToast } from './run-mode.js'
import { refreshLive } from '../refresh.js'
import { loadOptions } from '../sessions/actions.js'

const newPicker = createPicker($('#new-picker'), () => newPreview())
function newPreview() {
  const folder = newPicker.path, name = $('#new-name').value.trim(), model = $('#new-model').value
  const q = text => `'${text.replace(/'/g, `'\\''`)}'`
  $('#new-preview').textContent = folder ? `cd ${q(folder)} && claude${runMode() === 'hidden' ? ' --bg' : ''}${model ? ' --model ' + model : ''}${name ? ' --name ' + q(name) : ''}` : ''
}
async function openNewDialog() {
  await loadOptions()
  const options = state.options || { folders: [], models: [] }
  await newPicker.go(remembered('fleet-new-folder'))
  $('#new-model').innerHTML = options.models.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')
  $('#new-name').value = ''
  showRunMode('new-run')
  newPreview()
  $('#new-dialog').hidden = false
  $('#new-name').focus()
}
function closeNewDialog() { $('#new-dialog').hidden = true }

export function initNewSessionDialog() {
  for (const group of ['new-run', 'resume-run']) {
    document.querySelectorAll(`input[name="${group}"]`).forEach(input => input.addEventListener('change', () => { remember('fleet-run-mode', input.value); newPreview() }))
  }
  $('#new-session').addEventListener('click', openNewDialog)
  $('#new-cancel').addEventListener('click', closeNewDialog)
  $('#new-dialog').addEventListener('click', event => { if (event.target.id === 'new-dialog') closeNewDialog() })
  for (const id of ['#new-name', '#new-model']) $(id).addEventListener('input', newPreview)
  $('#new-form').addEventListener('submit', async event => {
    event.preventDefault()
    const button = $('#new-start')
    button.disabled = true
    try {
      remember('fleet-new-folder', newPicker.path)
      rememberFolder(newPicker.path)
      const result = await api('/api/sessions', { folder: newPicker.path, name: $('#new-name').value, model: $('#new-model').value, hidden: runMode() === 'hidden' })
      if (!result.ok) return toast(result.reason)
      closeNewDialog()
      startedToast(result, 'Started')
      setTimeout(refreshLive, 4000)
    } catch (error) { toast(error.message) } finally { button.disabled = false }
  })
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#new-dialog').hidden) closeNewDialog() })
}
