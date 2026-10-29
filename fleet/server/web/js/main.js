// The dashboard's entry point. Every other module only declares; this one wires
// them up in a fixed order, then loads the first data and starts the polling
// timers.

import { $ } from './core/dom.js'
import { state } from './core/state.js'
import { remembered } from './core/storage.js'
import { initCompactDialog } from './dialogs/compact.js'
import { initConnection } from './dialogs/connection.js'
import { initEndSessionDialog } from './dialogs/end-session.js'
import { initNewSessionDialog } from './dialogs/new-session.js'
import { initResumeDialog } from './dialogs/resume.js'
import { initSwitchModelDialog } from './dialogs/switch-model.js'
import { office, startOffice } from './office/index.js'
import { refreshLive, refreshReport } from './refresh.js'
import { initReportControls } from './reports/controls.js'
import { loadOptions } from './sessions/actions.js'
import { initSessionEvents } from './sessions/events.js'
import { initKeyboard } from './sessions/keyboard.js'
import { initLayout } from './sessions/layout.js'
import { renderLive } from './sessions/live.js'
import { refreshScreens } from './sessions/screen.js'
import { initTabs, setTab } from './tabs.js'
import { initTheme } from './theme.js'
import { initTooltip } from './tooltip.js'

// Listeners first, and the order matters: where two share a target, the first
// added runs first.
initTheme()
initLayout()
initSessionEvents()
initKeyboard()
initNewSessionDialog()
initResumeDialog()
initCompactDialog()
initSwitchModelDialog()
initEndSessionDialog()
initTooltip()
initReportControls()
startOffice()
initTabs()

// The office repaints in the new colours after theme.js has renamed the theme.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => office.themeChanged())
// The layout and tab this browser last showed.
state.view = remembered('fleet-sessions-view') === 'table' ? 'table' : 'list'
$('#view-sessions').dataset.layout = state.view
document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)))
setTab(location.hash === '#office' ? 'office' : location.hash === '#reports' ? 'reports' : remembered('fleet-tab') || 'sessions')

initConnection()
// The first data, then polling: the live view every 2 seconds, a shown hidden
// session's screen as often, the report every 20.
loadOptions().then(() => renderLive())
refreshLive(); refreshReport()
setInterval(refreshLive, 2000)
setInterval(() => { if (state.showScreen.size) refreshScreens().then(() => { if (!(document.activeElement && document.activeElement.tagName === 'SELECT')) renderLive() }) }, 2000)
setInterval(refreshReport, 20000)
