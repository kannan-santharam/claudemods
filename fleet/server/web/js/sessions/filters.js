// The filter chips and search box both session views share.

import { $ } from '../core/dom.js'
import { state } from '../core/state.js'

// Which sessions the table lists: the segment picked above it and the search box.
const FILTERS = [
  ['all', 'All', () => true],
  ['waiting', 'Needs you', session => session.status === 'waiting'],
  ['working', 'Working', session => session.status === 'busy'],
  ['idle', 'Idle', session => session.status === 'idle' || session.status === 'shell'],
  ['hidden', 'Hidden', session => session.hidden],
]
export function matchesFilter(session) {
  const test = (FILTERS.find(filter => filter[0] === state.filter) || FILTERS[0])[2]
  const query = state.search.trim().toLowerCase()
  return test(session) && (!query || `${session.name} ${session.folder} ${session.branch || ''} ${session.jobId || ''}`.toLowerCase().includes(query))
}
export function renderFilters(sessions) {
  const html = FILTERS.map(([key, label, test]) => {
    const count = sessions.filter(test).length
    if (key === 'hidden' && !count) return ''
    return `<button type="button" data-filter="${key}" aria-pressed="${state.filter === key}">${label}<span>${count}</span></button>`
  }).join('')
  if ($('#live-filters').innerHTML !== html) $('#live-filters').innerHTML = html
  // The List view's column has the same chips, compact: its group headings carry the counts.
  const compact = FILTERS.map(([key, label, test]) => {
    const count = sessions.filter(test).length
    if (key === 'hidden' && !count) return ''
    return `<button type="button" data-filter="${key}" aria-pressed="${state.filter === key}" title="${count} session${count === 1 ? '' : 's'}">${label}</button>`
  }).join('')
  if ($('#nav-filters').innerHTML !== compact) $('#nav-filters').innerHTML = compact
}
