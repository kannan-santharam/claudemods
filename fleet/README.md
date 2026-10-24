# Fleet — a dashboard for all your Claude Code sessions

If you run Claude Code in many terminal tabs at once, Fleet gives you one place to see and steer all of them. It is a Claude Code mod with two faces: a pane inside any session (`/fleet`) and a browser dashboard (`/fleet web`) with live status, reports and charts.

## What it does

- **Live list of every session** on your Mac: who is working, who is idle, who is waiting for you, with model, folder, branch, how full the context is, tokens and estimated cost today, and the last prompt and last reply.
- **Sessions and their subagents as a tree**: each session's running subagents sit under it until they finish, and a session started by another one, such as a headless `claude -p` run from a tool, is nested under the session it came from. A session idle while work runs under it shows as **Delegating**.
- **Office view**: a second tab draws every session as a person in an animated office. Working sessions sit at their desk with a screen showing what they are doing (code, a page being read, a terminal), a session waiting for you stands up with a "!", idle ones relax in the lounge, running subagents are helpers on stools beside their session and a headless session is a robot at the server racks. Hover for details, click to open the session in the list, double-click to jump to its tab. It respects reduced motion and only animates while you are looking at it.
- **Jump to a session's terminal tab** with one click (Terminal and iTerm2).
- **Message a session** from the browser or the pane. A connected session takes the message as if you typed it; an older session gets it typed into its tab once it is idle.
- **Switch a session's model, rename it, compact it (hover its context bar) or end it** from the browser, or select several and end them together. Ending stops it the way closing it would, so its conversation is kept and it can be resumed.
- **Start a new session** in any folder you browse to (breadcrumbs, subfolders, recent folders), with a name and a model, or **resume a past one** from that folder's history.
- **Reports**: estimated cost or tokens per day by model, a 24-hour activity timeline with the time each session waited for you, cost by project, top sessions, context fill, tool calls and a per-project table (sessions, prompts, commits, files edited, branches).
- **Plan usage**: your 5-hour and weekly limits as Claude Code reports them, with the time left until each resets.

Costs are an estimate at API list prices. On a Claude subscription they are not a bill; they show what the same traffic would cost on the API.

## Requirements

- macOS, with Terminal or iTerm2
- Claude Code with mods (function-hook plugins) enabled
- Node.js 18 or newer. The dashboard server is one small Node script with no dependencies; the mod finds Node on your PATH or where Homebrew, nvm, fnm, volta or asdf keep it.

## Install

At the prompt of a Claude Code session:

```
/plugin install fleet --marketplace kannan-santharam/claudemods
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

From a shell:

```
claude plugin install fleet --marketplace kannan-santharam/claudemods
```

Sessions started after the install load the mod. Sessions already running still show up on the dashboard (as "not connected"), and messages reach them by being typed into their tab.

## Use

- `/fleet` opens the pane beside the conversation; run it again (or `/fleet close`) to close it.
- `/fleet web` opens the browser dashboard at http://127.0.0.1:8770, signed in. Opening that address any other way shows a prompt to run `/fleet web`: the dashboard only opens for you. Any session with the mod starts the dashboard server if it is not running, and it stops by itself after an hour with no Claude sessions. After a plugin update, the first session on the new version replaces the old server.

The first time you click **Open tab**, start a session or send a message to an older session, macOS asks whether Claude may control Terminal (or iTerm2). Allow it in System Settings › Privacy & Security › Automation. New and resumed sessions open as a new tab in the front window, in Terminal if it is running, otherwise in iTerm2. Terminal has no command for a new tab, so Fleet presses ⌘T for you, which needs Terminal allowed in System Settings › Privacy & Security › Accessibility; until then they open in a new window and the dashboard tells you so.

### What it reads, runs and sends

- Reads `~/.claude/sessions`, the transcripts under `~/.claude/projects` (the last 8 days), `ps` and `git` in each session's folder.
- Runs `osascript` to bring a tab to the front, type a message into an older session's tab, open a new Terminal or iTerm2 tab (or window) for a session you start or resume; `claude` to start or resume a session; and sends a session `SIGTERM` (or `SIGKILL` if you force it) when you end it from the dashboard.
- Typing into a tab only happens while that session is idle with Claude in the foreground, never into a plain shell.

## Settings

`~/.claude/fleet/config.json`, written on first start:

```json
{
  "excludePaths": ["~/side-projects"],
  "newSessionRoot": "~/code"
}
```

- `excludePaths`: folders the dashboard ignores entirely: no sessions, transcripts or figures from under them.
- `newSessionRoot`: the folder whose subfolders the New session and Resume session dialogs offer. Defaults to your home folder.

To run a second dashboard beside the first, start the server with `FLEET_PORT` and `FLEET_DATA_DIR` set (for example `FLEET_PORT=8790 FLEET_DATA_DIR=~/.claude/fleet-preview node server/fleet-server.mjs`); the sessions only report to the one on 8770, and you sign in to the second by visiting `/auth?code=` with a code from its own `/api/login-code`.

`~/.claude/fleet/pricing.json` holds the per-model prices used for the cost estimate, if you want to change them.

## Privacy and security

Everything stays on your machine. The server listens on 127.0.0.1 only and refuses requests addressed to any other host name.

- Your sessions authenticate with a token kept in `~/.claude/fleet/token`; the browser with an HttpOnly, SameSite=Strict cookie it gets from a one-time code that only `/fleet web` can ask for. The page itself holds no secret, so another account on the Mac, or a web page you visit, cannot read or drive your sessions.
- The data folder `~/.claude/fleet` and every file in it are readable by you alone.
- The page cannot be framed by another site, and actions need a header only the page sends.
- The only network request the page makes is for Chart.js 4.4.1 from cdn.jsdelivr.net, checked against its integrity hash.

## License

MIT
