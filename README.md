# Local Runner

**Languages:** [English](README.md) · [简体中文](README.zh-CN.md)

Run local shell commands from an Obsidian sidebar tab and stream their output live, alongside built-in wikilink inspection and a visual repair-history tree. Each command gets its own card with a status indicator and an expandable log — useful for keeping `npm run dev`, `npx vite`, or any CLI tool running while you take notes.

> Desktop only. The plugin spawns child processes through Node's `child_process`, which is unavailable in the Obsidian mobile sandbox.

## Features

### Process management
- **Parallel processes** — run several commands at once, each with its own output panel.
- **Quick-launch bar** — one button per command defined in Settings. Click to start, click again to stop. A status dot shows the state: running (yellow), exited with error (red), or idle (gray).
- **Live streaming output** — stdout and stderr are merged, ANSI escapes are stripped, and the buffer is capped at 200,000 characters to bound memory.
- **Per-card logs** — click a card in the terminal-output section to expand or collapse its log; drag cards to reorder them.
- **Windows-aware termination** — stopping a process runs `taskkill /T /F` to kill the whole process tree so a dev server does not keep holding your port; other platforms fall back to `SIGTERM`.

### Wikilink tooling
- **Unresolved-wikilink list** — the upper section of the sidebar lists every unresolved `[[ ]]` link, newest source note first, with incremental load-more.
- **Clear unresolved links** — the eraser button converts every unresolved `[[x]]` in the vault to `[x]` after a confirmation prompt. A separate command flattens only the current note's wikilinks.
- **Auto-rescan on process exit** — per-command checkbox "rescan wikilink tree when the process exits successfully"; when the command finishes with exit code 0, the plugin re-scans the note that was active when the process was launched and refreshes the wikilink tree for its topic. Off by default (opt-in) to avoid hammering the vault for long-lived processes like a dev server.
- **Repair-history tree** — a pannable, zoomable canvas (the **tree** button) visualizes every vault scan. Open the tree zone and click its `list-tree` icon to scan the topic rooted at the current note (computed by walking the `bklink` frontmatter chain upward until a node with no incoming bklink is found); the canvas auto-highlights the note you currently have open, click a node to jump to its source note. Node collapse state is persisted per topic.
- **Highlight wikilinks** — optionally style internal links by resolution state, with configurable colors for resolved and unresolved links in both light and dark themes.

### Data and persistence
- **Survives restarts and uninstall** — commands, settings, and repair-tree events are persisted. With "keep data on uninstall" enabled (default), a backup is also written into the vault, outside the plugin folder, and restored automatically on reinstall.
- **Install Claude skills into the vault** — install any skill from a `degit` source (for example `owner/repo/skills/<dir>#main`) into `<vault>/.claude/skills/<name>`, and uninstall it from the same place.

## Requirements
- **Desktop only.**
- Obsidian **1.7.2** or newer.

## Installation

### From the community plugin store (after publication)
1. Settings → Community plugins → Browse
2. Search for **Local Runner**
3. Install, then enable.

### From a GitHub release
1. Download the latest release from the [Releases page](https://github.com/On-DevPlan/ob-ps/releases).
2. In your vault, create the folder `.obsidian/plugins/local-runner/`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into it.
4. Settings → Community plugins → reload, then enable **Local Runner**.

## Usage

1. **Open the sidebar** — command palette → "Open sidebar", or click the play icon in the left ribbon.
2. **Add a command** — Settings → Local Runner → **Process** tab → **Command groups** → **+ New**. Fill in a name, the shell command, and optionally a working directory. A quick-launch button for it then appears in the sidebar.
3. **Start and stop** — click the command's button in the quick-launch bar.
4. **Read logs** — click the **Log** button to reveal the terminal-output section, then click a process card to expand its log.
5. **Inspect wikilinks** — the upper section lists unresolved links. Click the eraser to clear all of them across the vault, or use the command palette to flatten the current note's links.
6. **Generate the wikilink tree** — click the **tree** button in the utility row to reveal the tree zone, then click the zone's `list-tree` icon to scan the topic rooted at the currently active note. The result renders as a pannable canvas.
7. **Inspect the wikilink tree** — drag to pan, scroll to zoom, double-click to fit, click a node to jump to its source note.

## Settings

Settings → Local Runner is split into three tabs.

### Process tab
- **Keep data on uninstall** — when enabled (default), commands and settings are also backed up into the vault and restored on reinstall; turning it off deletes the existing backup.
- **Command groups** — manage the quick-launch commands: name, command, working directory, visibility, and the auto-rescan-on-exit toggle.

### Wikilink tab
- **Highlight wikilinks** — toggle internal-link highlighting, and pick colors for resolved and unresolved links in light and dark themes.
- **Resolved-recent limit** — how many of the most recently resolved wikilinks the sidebar shows (1–50). Deduplicated by target and ordered by source-note ctime.
- **Wikilink-tree data** (collapsed by default) — grouped statistics of scan events by topic root, with a delete button per topic and a clear-all action. Use this to purge legacy events or wipe the tree history.

### Skill tab
- **Install skill from remote repo** — paste a `degit` source (`owner/repo/skills/<dir>#<ref>`) to install a skill into the vault's `.claude/skills/`; remove an installed skill with its per-row button.

## Commands
- **Open sidebar** — reveal the Local Runner panel.
- **Open settings** — jump straight to the plugin's settings tab.
- **Flatten current note's wikilinks** — convert every `[[link]]` in the active note to `[link]`.

## Security
- Commands run through `child_process.spawn` with `shell: true`, equivalent to typing them in a terminal. Pipes, arguments, and shell syntax are all supported.
- **Do not** use the plugin to run untrusted commands or to parse untrusted input.
- The default working directory is the vault root; child processes inherit Obsidian's environment.
- On Windows, stopping a process kills the whole process tree; on other platforms only the direct child receives `SIGTERM`.

## Development

```bash
npm install          # install dependencies
npm run dev          # watch mode: rebuild on change and sync to a vault
npm run build        # type-check + production build (outputs main.js at the repo root)
npm run lint         # eslint
npm test             # run the vitest suite once
npm run test:watch   # vitest in watch mode
```

In dev mode, `main.js`, `manifest.json`, and `styles.css` are synced into a vault plugin folder for hot reload. Override the target with:

```bash
LOCAL_RUNNER_VAULT=/path/to/vault/.obsidian/plugins/local-runner npm run dev
```

Production builds write only to the repo root; release packaging is handled by CI.

## Release

Releases are automated. Every push to `main` triggers GitHub Actions to:

1. Bump the patch version in `manifest.json` and append a matching entry to `versions.json`.
2. Type-check and build.
3. Package `local-runner-<version>.zip` containing `main.js`, `manifest.json`, and `styles.css`.
4. Attest build provenance for the artifacts.
5. Commit the version bump with `[skip ci]`, tag it, and publish a GitHub Release.

For day-to-day work, `git push origin main` is all you need. Submitting to the Obsidian community store is a separate step: open a PR against [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) and add an entry to `community-plugins.json`.

## License

ISC — see [LICENSE](LICENSE).
