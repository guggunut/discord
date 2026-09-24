# Weididdy Bot

A Discord bot inspired by GenAI. It reads the chat, learns the words people use, and every few messages posts a random mashup of them. Each mashup is a different length. If you @mention it or reply to it, it answers properly using Claude. It can look at images you attach and search the web.

## Features

- **Word mashups:** learns from every message in the server and posts a remix every *N* messages. Each server has its own vocabulary.
- **Chat:** @mention it or reply to one of its messages and it replies. It reads the last 20 messages in the channel for context.
- **Reads images:** attach an image (PNG, JPEG, GIF, WebP, up to 5 MB) when you talk to it and it can see the image.
- **Web search:** it searches the web when a question needs current info.
- **Images and GIFs:** like GenAI, it learns links (Tenor GIFs, image links, and images people upload) and mixes them into mashups, where Discord shows them as embeds. Each mashup has at most one link. An admin can turn this off with `/links`.
- **No pings:** it strips @mentions and @everyone from what it learns, and it never pings anyone when it posts.

## Slash commands

| Command | Who can use it | What it does |
| --- | --- | --- |
| `/generate` | everyone | Post a mashup right now |
| `/stats` | everyone | Show how many words it has learned and the current settings |
| `/frequency <messages>` | Manage Server | Post a mashup every *N* messages (`0` = off). Default: 10 |
| `/length <min> <max>` | Manage Server | Shortest and longest mashup, in words. Default: 3–25 |
| `/chance <percent>` | Manage Server | Extra % chance of a mashup on any message. Default: 0 |
| `/links <on/off>` | Manage Server | Learn and repost links, images and GIFs. Default: on. Turning it off also forgets learned links |
| `/ignore` | Manage Server | Stop or restart learning and posting in the current channel |
| `/forget` | Manage Server | Wipe everything it has learned in this server |

Server admins can change who sees the Manage Server commands in **Server Settings → Integrations → Weididdy Bot**.

## Setup

### 1. Create the Discord bot

1. Go to <https://discord.com/developers/applications> and click **New Application**. Name it `Weididdy Bot`.
2. Open the **Bot** tab:
   - Click **Reset Token** and copy the token. You'll need it in step 3.
   - Under **Privileged Gateway Intents**, turn on **Message Content Intent**. The bot can't read chat without it.
3. Open the **OAuth2 → URL Generator** tab:
   - Scopes: `bot` and `applications.commands`
   - Bot permissions: `View Channels`, `Send Messages`, `Read Message History`, `Attach Files`
   - Open the generated URL and add the bot to your server.

### 2. Get a Claude API key (optional, for the AI chat)

Create a key at <https://console.anthropic.com/>. Without a key, the mashups still work, and @mentions get a mashup instead of an AI reply.

### 3. Run it

You need Python 3.10 or newer.

```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env             # then open .env and fill in your tokens
python -m weididdy
```

Slash commands can take a while to show up the first time. To see them immediately, put your server's ID in `DEV_GUILD_ID` in `.env`. To copy the ID, turn on Developer Mode in Discord, then right-click the server.

## Configuration (`.env`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | Your bot token |
| `ANTHROPIC_API_KEY` | none | Turns on the Claude AI replies |
| `CLAUDE_MODEL` | `claude-opus-5` | Which Claude model to use |
| `CLAUDE_EFFORT` | `medium` | `low`, `medium` or `high`. Higher is smarter but slower and costs more |
| `CHAT_HISTORY` | `20` | How many recent messages Claude reads for context |
| `WEIDIDDY_DB` | `weididdy.db` | SQLite file for learned words and settings |
| `DEV_GUILD_ID` | none | Sync slash commands to this server instantly |

## Notes

- The Claude API is billed per use. Every @mention or reply to the bot is one API call, plus any web searches it runs. Mashups are free and run locally.
- Reposted links are ordinary links, so if the original image or GIF is deleted, its embed stops working.
- The bot learns only while it's running, and keeps learned words and settings in `weididdy.db`.

## Development

```bash
pip install pytest
python -m pytest
```
