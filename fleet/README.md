# Fleet — a dashboard for all your Claude Code sessions

## Installation

Mac only, needs Node.js 18 or newer.

1. In Claude Code, run:

   ```
   /plugin install fleet --marketplace kannan-santharam/claudemods
   ```

2. Answer `y`, then choose `user`.

3. Open a new Claude session and run:

   ```
   /fleet web
   ```

## Demo

Fleet in one minute, with sound and subtitles.

https://github.com/user-attachments/assets/30aec2e9-12f6-454f-96ce-b6a48a0a400d

## About

If you run Claude Code in many terminal tabs at once, Fleet gives you one place to see and steer all of them. It is a Claude Code mod with two faces: a pane inside any session (`/fleet`) and a browser dashboard (`/fleet web`) with live status, reports and charts.

## What it does

- **Every session on one screen**, laid out like a chat app: on the left every session on your Mac in alphabetical order, each with its status, model, folder and how full its context is, plus a button that jumps to its terminal tab; in the middle the conversation of the one you pick, with the message box always at the bottom; on the right that session's figures (context, tokens and cost today, subagents, background shells), your headline numbers and a small live Office. Whoever is waiting for you wears a thin turning multi-colour ring. A **List | Table** switch brings up a table instead, for comparing sessions column by column and ending several at once. Press J and K to move between sessions.
- **Sessions and their subagents as a tree**: each session's running subagents sit under it until they finish, and a session started by another one, such as a headless `claude -p` run from a tool, is nested under the session it came from. A session idle while work runs under it shows as **Delegating**.
- **Office view**: its own tab draws every session as a person in an animated isometric office. Each project folder gets its own row of desks on a coloured rug, and the room grows as sessions join. Working sessions sit at their desk with a screen showing what they are doing and a paper pile that grows with their context, a session waiting for you stands up and waves, and idle ones head to the lounge for the sofa, ping-pong or coffee. What someone wears tells you the model (a blazer for Opus, a hoodie for Sonnet, a beanie for Haiku, headphones for Fable). Commits fly to the outbox as parcels, pushes leave through the window as paper planes, and a compaction is a walk to the shredder. Running subagents are helpers in caps, background shells are small humming boxes by the desk, and a headless session is a robot at the server racks. The room follows your local time of day and the dark theme is the night shift. There is a ticker of what happened, a wall mode for a second screen, zoom, and buttons to save a snapshot or a short clip. Hover for details, click to open the session in the list, double-click to jump to its tab. It respects reduced motion and only animates while you are looking at it.
- **Hidden sessions**: start or resume a session hidden instead of in a terminal tab. It runs in Claude Code's own background service (`claude --bg`), so no window opens and the dashboard is how you reach it. Hidden sessions show their id, and **Open in terminal** attaches one to a tab whenever you want to look; closing that tab leaves it running.
- **Questions on the web**: when a session asks you something or needs permission for a tool, a card appears in its chat with the options as buttons (or Allow, Allow for this session and Deny), and your answer goes straight back to it. A session in a terminal asks there as well, and whichever you answer first counts: the other one goes away. Fleet reads the tab before it answers a permission prompt from the web, and gives an Allow by pressing Enter on the terminal's own prompt, so that needs the session in Terminal or iTerm2; questions work in any terminal. A hidden session's **Screen** view shows what its terminal displays for anything else. In auto mode Claude Code's own checks still settle permissions themselves.
- **Background shells**: commands a session runs in the background (a dev server, a test run) show under it with the last line they printed, and a tag on the row says how many are running.
- **Jump to a session's terminal tab** with one click (Terminal and iTerm2).
- **Message a session** from the browser or the pane. A connected session takes the message as if you typed it; an older session gets it typed into its tab once it is idle.
- **Switch a session's model, rename it, compact it or end it** from the browser (Open tab, Compact and End session sit above its chat, the rest under Actions), or select several in the table and end them together. Ending stops it the way closing it would and closes its terminal tab too (unless that tab still runs something else), so its conversation is kept and it can be resumed.
- **Start a new session** in any folder you browse to (breadcrumbs, subfolders, recent folders), with a name and a model, or **resume a past one**, with the last ten sessions you closed listed first so each is one click away, or any session from a folder's history.
- **Reports** in their own tab: estimated cost or tokens per day by model, a 24-hour activity timeline with the time each session waited for you, cost by project, top sessions, context fill, tool calls and a per-project table (sessions, prompts, commits, files edited, branches).
- **Plan usage**: your 5-hour and weekly limits as Claude Code reports them, with the time left until each resets.

Costs are an estimate at API list prices. On a Claude subscription they are not a bill; they show what the same traffic would cost on the API.

## Requirements

- macOS, with Terminal or iTerm2
- Claude Code with mods (function-hook plugins) enabled
- Node.js 18 or newer. The dashboard server is a small set of plain Node modules with no dependencies; the mod finds Node on your PATH or where Homebrew, nvm, fnm, volta or asdf keep it.

## More on installing

The user scope loads Fleet in every session. To install from a shell instead:

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
- Runs `osascript` to bring a tab to the front, type a message into an older session's tab, open a new Terminal or iTerm2 tab (or window) for a session you start or resume, and close a session's tab after it ends; `claude` to start or resume a session, and `claude --bg`, `claude logs`, `claude attach` and `claude stop` for hidden ones; and sends a session `SIGTERM` (or `SIGKILL` if you force it) when you end it from the dashboard.
- Reads the output file of a session's background shells (under the temporary folder Claude Code writes them to) to show their last line.
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

## Layout

For anyone reading or changing the code. There is no build step: what is in the folder is what runs.

- `hooks/register.tsx` is the mod itself. It only wires up `hooks/lib`, where each concern has its own file: the pane, the `/fleet` command, the session scan, messaging and starting the server.
- `server/fleet-server.mjs` is the entry the mod starts, and it starts the modules in `server/lib`, one per concern, with the HTTP routes in `server/lib/routes`.
- `server/web` is the page: `index.html`, its stylesheets in `css/` and its modules in `js/`, with `main.js` wiring them up in `core` (state, API calls, formatting), `sessions`, `dialogs`, `reports` and `office` (the Office tab).

## License

MIT
