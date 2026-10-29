import { ago, esc, shortModel } from '../core/format.js'
import { MODEL_ALIASES, modelColor } from '../core/models.js'

export function subagentRows(s, depth) {
  return s.subagents.map(a => {
    const model = MODEL_ALIASES[a.model] || a.model
    return `
    <tr class="subagent">
      <td></td>
      <td><span class="pill busy"><i class="dot"></i>Running</span></td>
      <td><div class="nested" style="padding-left:${(depth + 1) * 22}px"><span class="branch">↳</span><div>
        <div class="name sub" title="${esc(a.description)}">${esc(a.description)}</div>
        <div class="where"><span>${esc(a.agentType || 'subagent')}</span><span class="tag">subagent${a.isBackground ? ' · background' : ''}</span></div>
      </div></div></td>
      <td class="hide-sm">${model ? `<span class="chip"><i class="sw" style="background:${modelColor(model)}"></i>${esc(shortModel(model))}</span>` : ''}</td>
      <td></td><td class="hide-sm"></td>
      <td class="num hide-sm">for ${ago(a.startedAt)}</td>
      <td></td>
    </tr>`
  }).join('')
}
// Background shells a session started (a dev server, a test run) sit under it too,
// with the last line they printed.
export function shellRows(s, depth) {
  return (s.shells || []).map(shell => `
    <tr class="subagent shell">
      <td></td>
      <td><span class="pill busy"><i class="dot"></i>Running</span></td>
      <td><div class="nested" style="padding-left:${(depth + 1) * 22}px"><span class="branch">↳</span><div>
        <div class="name sub" title="${esc(shell.command)}">${esc(shell.description || shell.command || 'Background shell')}</div>
        <div class="where"><code title="${esc(shell.command)}">${esc(shell.command.length > 70 ? shell.command.slice(0, 69) + '…' : shell.command)}</code><span class="tag shell-kind">background shell</span></div>
        ${shell.lastOutput ? `<div class="shell-out" title="${esc(shell.lastOutput)}"><code>${esc(shell.lastOutput)}</code>${shell.outputAt ? ` <span>${esc(ago(shell.outputAt))} ago</span>` : ''}</div>` : ''}
      </div></div></td>
      <td class="hide-sm"></td>
      <td></td><td class="hide-sm"></td>
      <td class="num hide-sm">for ${ago(shell.startedAt)}</td>
      <td></td>
    </tr>`).join('')
}
