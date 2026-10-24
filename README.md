# Claude Code mods

Mods for [Claude Code](https://claude.com/claude-code), one folder per mod. The repository is also a plugin marketplace, so any mod here installs with one command.

## Installation

Fleet, Mac only, needs Node.js 18 or newer.

1. In Claude Code, run:

   ```
   /plugin install fleet --marketplace kannan-santharam/claudemods
   ```

2. Answer `y`, then choose `user`.

3. Open a new Claude session and run:

   ```
   /fleet web
   ```

## Mods

| Mod | What it does |
| --- | --- |
| [fleet](fleet/) | A live dashboard for every Claude Code session on your Mac: who is working, who is idle and who needs you, with cost, context and activity reports, an animated office view, and one click to jump to a session's terminal tab, message it, switch its model or end it. |

Each mod installs on its own: `/plugin install <mod> --marketplace kannan-santharam/claudemods`. Its README covers what it needs and how to use it.

## License

MIT
