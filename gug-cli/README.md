# GUG-cli

**Your agents. Your keys.** GUG-cli is an agentic OS that runs on your own computer: twelve specialist AI agents, a vibe-coding studio, a multi-agent "roundtable", money and market tracking, an art and voice studio, a content calendar, automations and a now-playing media player — in a black, white and signal-red interface with 3D, sound and motion.

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

`gug serve` opens GUG-cli in its own app window (Edge, Chrome or Brave; `--tab` for a normal browser tab) on a **private link** (`http://127.0.0.1:4747/#token=…`). That link is how GUG-cli knows it's you — keep it to yourself. Lost it? Run `gug link`.

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
| **Command center** | Pick agents and message them all. One agent = direct chat; several = they take turns, build on each other, and Atlas sums up. With several agents, choose **Turns** (they answer in turn and build on each other) or **Team** (Atlas hands each agent a concrete task, they do their part with their tools, Atlas combines it). Press the mic to dictate. Drag the 3D core to spin it, click to pulse; modes change its shape. The **Today** panel is a live briefing: new inbox items, today's posts, profit, market movers and the next automation. |
| **Agent room** | Twelve agents (Atlas, Ledger, Quant, Muse, Echo, Relay, Scout, Forge, Vox, Tempo, Sage, Sentinel), each with its own chat history, engine and data-access setting. Agents use **tools** on your GUG-cli data — Ledger reads and logs money, Quant checks prices, Echo drafts posts, Relay sets up flows, Tempo reads your calendar and focus time — and every action shows in the chat. **Shared memory** (an About-you note plus facts, and “remember that…”) reaches all twelve. |
| **Code** | Vibe coding: describe what you want, Forge builds it. Start from a template (landing page, arcade game, Roblox Luau scripts) and download any project as a .zip. *Claude Code* works inside the project folder; *Claude API* writes complete files. Live sandboxed preview, file editor, build log. |
| **Apps** | Claude API, Claude Code, GitHub (list + clone repos into Code), Discord alerts, local models, and **Local API** tokens so your own scripts — like a Discord bot on the same PC — can ask the agents (ask-only, rate-limited; a ready-made slash command is included). |
| **Ventures** | Income tracker for stores, Roblox games (entered in R$, converted at your DevEx rate) and digital products: sales, costs, refunds, KPIs vs the previous period, charts, and a Ledger review of the numbers. Sample data to explore, and **CSV import** (Shopify order exports are read automatically; re-importing skips orders already there). |
| **Markets** | Watchlist with live quotes (Yahoo Finance for stocks/funds, CoinGecko for crypto — public feeds, may be delayed), interactive charts with range stats, price alerts to your inbox, a $10,000 **paper-trading** account, and Quant explaining charts in plain English. Never real trades, never advice. |
| **Studio** | Muse draws vector artwork (sanitised SVG, export SVG or 2048px PNG, drop into a Code project, hand to Echo for captions). Vox writes voiceover scripts and reads them with your computer's built-in voices. |
| **Growth** | Weekly content calendar for Instagram, TikTok, YouTube, X and Discord. Echo plans a week of drafts and rewrites captions; approve, post to Discord in one click, log views and likes. |
| **Flows** | Automations: run one or more agents on a schedule (daily, every N minutes) or on demand, each step seeing the last, delivered to your inbox or Discord. |
| **Academy** | Eight playbooks (AI dropshipping, AI-assisted investing, Roblox income, faceless channels and more) with progress tracking and a button to run the next step with the right agents. |
| **Setup guide** | Five interactive steps from zero to your first agent job. |
| **Settings** | Encrypted API keys (with backup keys), engine routing, Claude Code permissions, **Router & usage** (tokens per model, fallbacks, what's cooling down), sound & motion, desktop notifications, and backup/restore (never includes keys). |
| **Focus timer** | 25/50/90-minute sessions from the top bar with optional brown noise; minutes and streaks show in the Today briefing and Tempo/Sage can see them. |
| **Now playing** | Shows and controls whatever music is playing on your computer. |

**Anywhere:** press **Ctrl/⌘ + K** (or `/`) for the command palette, `g` then a letter to jump (g M = Markets), and `?` for all shortcuts. The palette jumps to any screen, run quick actions, or type a question and it's routed to the agent whose speciality fits (a tax question goes to Ledger, a logo to Muse). On narrow windows a bottom bar replaces the side rail.

### Engines and the router

- **Claude** — `claude-opus-5-5` first, falling back to `claude-sonnet-5-5` and `claude-haiku-4-5` (and across your backup keys) on rate limits, overloads or outages. A key+model that just hit a limit **cools down** (honouring `retry-after`) and later requests skip straight past it. Policy refusals are retried server-side with Anthropic's `fallbacks: "default"`.
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
gug serve [--port 4747] [--no-open] [--tab]   Start the app (own window by default)
gug link                               Print your private link again
gug key add | gug key remove           Save or delete your Claude API key
gug chat [--agent atlas] [--mode deep] "…"
gug code [--plan] "…"                  Claude Code on the current folder
gug roundtable [--agents atlas,ledger,echo] [--mode debate] "…"
gug agents                             List the agents
gug doctor                             Check your setup

gug today                              Today's briefing (inbox, posts, profit, movers, next flow)
gug money [--range 7d|30d|90d|12m]     Revenue, profit and margin by stream
gug log sale|cost|refund 34.99 --stream "Shop" [--note "…"] [--orders 2]
gug price AAPL [--span 1d|1w|1m|6m|1y] A live price with range stats
gug watch | gug watch add BTC | gug watch rm BTC
gug flows | gug flows run "Morning plan"
gug backup [--out file.json] [--chats] A backup without any keys
```

The data commands work whether or not the app is open; when it is, changes go through it so everything stays in sync.

## Privacy and security

GUG-cli v1 has no accounts and no cloud. Instead:

- It only listens on `127.0.0.1`, so other devices can't reach it.
- The UI and API need your **private link** (an httpOnly, SameSite=Strict cookie after the first visit).
- Requests must come from `localhost` (blocks DNS-rebinding) and carry a custom header (blocks cross-site requests).
- API keys and tokens are encrypted with AES-256-GCM using a key file (`vault.key`) readable only by your user.
- Vibe-coded previews run in a sandboxed, opaque origin with no access to the app.
- Generated artwork is stripped of scripts, event handlers and external links, and served with a sandboxing CSP.
- Discord posts are sent with mentions disabled, so nothing can ping `@everyone`.
- Only the numbers on screen are sent to Claude for Ledger/Quant reviews; market data comes from public feeds without any account.
- Your data lives in `~/.gug-cli` (override with `GUG_DATA`). Delete that folder to wipe everything.

## Development

```bash
npm run dev        # API with auto-restart + Vite with hot reload (http://localhost:5173)
npm test           # unit + HTTP security tests
npm run typecheck
```

The design canvas this app was built from lives in the Claude artifact "GUG-cli".
