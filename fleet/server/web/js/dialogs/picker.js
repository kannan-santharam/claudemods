import { api } from '../core/api.js'
import { toast } from '../core/dom.js'
import { esc } from '../core/format.js'

// ---------------------------------------------------------- folder picker --
// The folder you are in is the one picked: click a subfolder to go into it,
// a crumb to go back up, a recent folder to jump straight there.
function recentFolders() { try { return JSON.parse(localStorage.getItem('fleet-recent-folders') || '[]') } catch { return [] } }
export function rememberFolder(folder) {
  const list = [folder, ...recentFolders().filter(entry => entry !== folder)].slice(0, 6)
  try { localStorage.setItem('fleet-recent-folders', JSON.stringify(list)) } catch {}
}
export function createPicker(container, onChange) {
  const picker = { path: '', isGit: false, home: '' }
  const tilde = full => picker.home && full.startsWith(picker.home) ? '~' + full.slice(picker.home.length) : full
  function render(result) {
    const recent = recentFolders().filter(entry => entry !== result.path)
    container.innerHTML = `
      ${recent.length ? `<div class="recent">${recent.map(entry => `<button type="button" data-path="${esc(entry)}" title="${esc(entry)}">${esc(entry.split('/').pop())}</button>`).join('')}</div>` : ''}
      <div class="crumbs">${result.crumbs.map((crumb, index) => index === result.crumbs.length - 1
        ? `<b>${esc(crumb.name)}</b>`
        : `<button type="button" data-path="${esc(crumb.path)}">${esc(crumb.name)}</button><span class="sep">›</span>`).join('')}</div>
      <div class="list">${result.folders.map(folder => `<button type="button" data-path="${esc(folder.path)}"><span class="glyph">▸</span>${esc(folder.name)}${folder.isGit ? '<span class="tag">git</span>' : ''}<span class="go">›</span></button>`).join('') || '<div class="empty">No subfolders here</div>'}</div>
      <div class="chosen">Selected: <code>${esc(tilde(result.path))}</code>${result.isGit ? ' · git repository' : ''}</div>`
  }
  async function go(target) {
    try {
      const result = await api('/api/browse?path=' + encodeURIComponent(target || ''))
      if (!result.ok) return toast(result.reason)
      picker.home = result.crumbs[0].path
      picker.path = result.path
      picker.isGit = result.isGit
      render(result)
      onChange && onChange(picker)
    } catch (error) { toast(error.message) }
  }
  container.addEventListener('click', event => {
    const target = event.target.closest('[data-path]')
    if (target) go(target.dataset.path)
  })
  picker.go = go
  return picker
}
