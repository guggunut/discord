# GUG-cli

**Your agents. Your keys.** GUG-cli is an agentic OS that runs on your own computer: twelve specialist AI agents, a vibe-coding studio, a multi-agent "roundtable", app connections and a now-playing media player — in a black, white and signal-red interface with 3D, sound and motion.

It uses **Claude** for thinking and writing, **Claude Code** for real coding inside your projects, and optionally a **local model** (Ollama / LM Studio) — and picks the right one per task.

---

## Quick start

You need **Node.js 20 or newer** ([download](https://nodejs.org)).

```bash
cd gug-cli
npm install
npm run build
npm link          # makes the `gug` command available everywhere (optional)
gug serve         # or: node bin/gug.mjs serve
```

`gug serve` opens your browser on a **private link** (`http://127.0.0.1:4747/#token=…`). That link is how GUG-cli knows it's you — keep it to yourself. Lost it? Run `gug link`.

Then follow the **Setup guide** in the app (the plug icon), or:

```bash
gug key add       # paste your Claude API key (stored encrypted)
```

Get a key at [platform.claude.com](https://platform.claude.com) → API keys.

### Windows

Run the same commands in **PowerShell** or **Windows Terminal**. If `npm link` needs admin rights, skip it and use `node bin\gug.mjs serve` from the `gug-cli` folder.

### Claude Code (recommended for coding)

```bash
npm install -g @anthropic-ai/claude-code
claude            # sign in once
```

Restart `gug serve` and the Code tab and Forge will use it automatically.

---

## What's inside

| Screen | What it does |
| --- | --- |
| **Command center** | Pick agents and message them all. One agent = direct chat; several = they take turns, build on each other, and Atlas sums up. Drag the 3D core to spin it, click to pulse; modes change its shape. |
| **Agent room** | Twelve agents (Atlas, Ledger, Quant, Muse, Echo, Relay, Scout, Forge, Vox, Tempo, Sage, Sentinel), each with its own chat history and engine setting. |
| **Code** | Vibe coding: describe what you want, Forge builds it. *Claude Code* works inside the project folder; *Claude API* writes complete files. Live sandboxed preview, file editor, build log. |
| **Apps** | Claude API, Claude Code, GitHub (list + clone repos into Code), Discord alerts, local models. |
| **Academy** | Eight playbooks (AI dropshipping, AI-assisted investing, Roblox income, faceless channels and more) with progress tracking and a button to run the next step with the right agents. |
| **Setup guide** | Five interactive steps from zero to your first agent job. |
| **Settings** | Encrypted API keys (with backup keys), engine routing, Claude Code permissions, sound & motion. |
| **Now playing** | Shows and controls whatever music is playing on your computer. |

### Engines and the router

- **Claude** — `claude-opus-5-5` first, falling back to `claude-sonnet-5-5` and `claude-haiku-4-5` (and across your backup keys) on rate limits, overloads or outages. Policy refusals are retried server-side with Anthropic's `fallbacks: "default"`.
- **Claude Code** — runs `claude -p … --output-format stream-json` in your project folder with a safe tool allow-list (read, edit, tests, `git status/diff`).
- **Local** — any Ollama-compatible server on `localhost`.
- **Auto** — code/repo work → Claude Code (when installed); "private/offline" → local; everything else → Claude.

### Now playing

| System | How |
| --- | --- |
| Windows | System media controls (Spotify, browsers, Apple Music, …) via PowerShell |
| macOS | Spotify or Music via AppleScript (allow the automation prompt the first time) |
| Linux | Any MPRIS player via `playerctl` (`sudo apt install playerctl`) |

---

## Command line

```text
gug serve [--port 4747] [--no-open]   Start the app
gug link                               Print your private link again
gug key add | gug key remove           Save or delete your Claude API key
gug chat [--agent atlas] [--mode deep] "…"
gug code [--plan] "…"                  Claude Code on the current folder
gug roundtable [--agents atlas,ledger,echo] [--mode debate] "…"
gug agents                             List the agents
gug doctor                             Check your setup
```

## Privacy and security

GUG-cli v1 has no accounts and no cloud. Instead:

- It only listens on `127.0.0.1`, so other devices can't reach it.
- The UI and API need your **private link** (an httpOnly, SameSite=Strict cookie after the first visit).
- Requests must come from `localhost` (blocks DNS-rebinding) and carry a custom header (blocks cross-site requests).
- API keys and tokens are encrypted with AES-256-GCM using a key file (`vault.key`) readable only by your user.
- Vibe-coded previews run in a sandboxed, opaque origin with no access to the app.
- Your data lives in `~/.gug-cli` (override with `GUG_DATA`). Delete that folder to wipe everything.

## Development

```bash
npm run dev        # API with auto-restart + Vite with hot reload (http://localhost:5173)
npm test           # unit + HTTP security tests
npm run typecheck
```

The design canvas this app was built from lives in the Claude artifact "GUG-cli".
