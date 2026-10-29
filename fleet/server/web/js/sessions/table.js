// The Table view's nested rows: running subagents and background shells under
// their session.

import { escapeHtml, shortModel, timeAgo } from '../core/format.js'
import { MODEL_ALIASES, modelColor } from '../core/models.js'

export function subagentRows(session, depth) {
  return session.subagents.map(agent => {
    const model = MODEL_ALIASES[agent.model] || agent.model
    return `
    <tr class="subagent">
      <td></td>
      <td><span class="pill busy"><i class="dot"></i>Running</span></td>
      <td><div class="nested" style="padding-left:${(depth + 1) * 22}px"><span class="branch">↳</span><div>
        <div class="name sub" title="${escapeHtml(agent.description)}">${escapeHtml(agent.description)}</div>
        <div class="where"><span>${escapeHtml(agent.agentType || 'subagent')}</span><span class="tag">subagent${agent.isBackground ? ' · background' : ''}</span></div>
      </div></div></td>
      <td class="hide-sm">${model ? `<span class="chip"><i class="sw" style="background:${modelColor(model)}"></i>${escapeHtml(shortModel(model))}</span>` : ''}</td>
      <td></td><td class="hide-sm"></td>
      <td class="num hide-sm">for ${timeAgo(agent.startedAt)}</td>
      <td></td>
    </tr>`
  }).join('')
}
// Background shells a session started (a dev server, a test run) sit under it too,
// with the last line they printed.
export function shellRows(session, depth) {
  return (session.shells || []).map(shell => `
    <tr class="subagent shell">
      <td></td>
      <td><span class="pill busy"><i class="dot"></i>Running</span></td>
      <td><div class="nested" style="padding-left:${(depth + 1) * 22}px"><span class="branch">↳</span><div>
        <div class="name sub" title="${escapeHtml(shell.command)}">${escapeHtml(shell.description || shell.command || 'Background shell')}</div>
        <div class="where"><code title="${escapeHtml(shell.command)}">${escapeHtml(shell.command.length > 70 ? shell.command.slice(0, 69) + '…' : shell.command)}</code><span class="tag shell-kind">background shell</span></div>
        ${shell.lastOutput ? `<div class="shell-out" title="${escapeHtml(shell.lastOutput)}"><code>${escapeHtml(shell.lastOutput)}</code>${shell.outputAt ? ` <span>${escapeHtml(timeAgo(shell.outputAt))} ago</span>` : ''}</div>` : ''}
      </div></div></td>
      <td class="hide-sm"></td>
      <td></td><td class="hide-sm"></td>
      <td class="num hide-sm">for ${timeAgo(shell.startedAt)}</td>
      <td></td>
    </tr>`).join('')
}
