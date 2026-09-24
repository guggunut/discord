"""
Weididdy Bot - a GenAI-style Discord bot with Claude chat. Everything is in this one file.

WHAT IT DOES
  * Learns the words (and image/GIF links) people say, and every few messages
    posts a random mashup of them.
  * Reads the last 500 messages of each channel the first time, so it can talk right away.
  * @mention it or reply to it and it answers with Claude (can see images, search the web).
  * Replies to trigger phrases you set in CUSTOM_REPLIES below.

HOW TO RUN IT (Windows)
  1. Install Python from python.org (tick "Add Python to PATH" in the installer).
  2. Open Command Prompt in the folder with this file and run, once:
         py -m pip install discord.py anthropic python-dotenv
  3. Start the bot:
         py weididdy_bot.py
     The first time, it asks for your Discord bot token (and optionally a Claude
     API key) and saves them in a ".env" file next to this script.

In the Discord Developer Portal, turn on "Message Content Intent" (Bot tab) and
invite the bot with the "bot" + "applications.commands" scopes and the
View Channels, Send Messages, Read Message History and Attach Files permissions.

Slash commands: /generate /stats /frequency /length /chance /links /ignore /forget
"""

from __future__ import annotations


# ===========================================================================
# CUSTOM REPLIES - edit this list, then restart the bot.
#
#   "trigger phrase": "what the bot says back",
#
# - Capitals don't matter; the phrase can be anywhere in the message, but only
#   whole words match ("hi" won't fire on "this" or "high").
# - Use a list for a random pick:  "gm": ["gm", "morning", "go back to bed"],
# - {user} becomes the person's name (it won't ping them).
# - Every line needs a comma at the end.
# ===========================================================================

CUSTOM_REPLIES = {
    "good morning": ["gm {user} ☀️", "morning!!", "go back to bed"],
    "good night": "gn {user} 😴",
    "who is weididdy": "the greatest bot to ever live",
    "ping": "pong 🏓",
}


# ===========================================================================
# You don't need to change anything below this line.
# ===========================================================================


import base64
import logging
import os
import random
import re
import sqlite3
import sys
import threading
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

try:
    import anthropic
    import discord
    from discord import app_commands
    from dotenv import load_dotenv
except ImportError:
    print("Some packages are missing. Run this command, then start the bot again:\n")
    print("    py -m pip install discord.py anthropic python-dotenv\n")
    input("Press Enter to close...")
    raise SystemExit(1)

log = logging.getLogger("weididdy")
HERE = Path(__file__).resolve().parent


# ---------------------------------------------------------------------------
# Word mashups (learns word chains per server, stored in SQLite)
# ---------------------------------------------------------------------------

# Control-character markers for "start of message" and "end of message";
# tokenize() strips them from real words so they can't collide.
START = "\x02"
END = "\x03"

_MENTION_RE = re.compile(r"<(@[!&]?|#)\d+>")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_EVERYONE_RE = re.compile(r"@(everyone|here)", re.IGNORECASE)

MAX_WORD_LEN = 40
MAX_LINK_LEN = 1000
MAX_LINKS_PER_MASHUP = 3


@dataclass
class GuildSettings:
    guild_id: int
    frequency: int = 10  # post a mashup every N learned messages; 0 = never
    min_words: int = 3
    max_words: int = 25
    reply_chance: int = 0  # extra % chance to post on any message
    learn_links: bool = True  # learn and repost links (images/GIFs embed)


def is_link(word: str) -> bool:
    return _URL_RE.fullmatch(word) is not None


def tokenize(text: str, keep_links: bool = True) -> list[str]:
    """Split a Discord message into learnable words.

    Mentions and @everyone/@here are dropped so the bot never pings anyone.
    Links are kept as single words (unless keep_links is False) so image and
    GIF links get reposted and Discord embeds them.
    """
    text = _MENTION_RE.sub(" ", text)
    text = _EVERYONE_RE.sub(" ", text)
    text = text.replace(START, " ").replace(END, " ")
    words = []
    for w in text.split():
        if is_link(w):
            if keep_links and len(w) <= MAX_LINK_LEN:
                words.append(w)
        elif len(w) <= MAX_WORD_LEN:
            words.append(w)
    return words


class MarkovStore:
    def __init__(self, db_path: str) -> None:
        self._db = sqlite3.connect(db_path, check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock, self._db:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(
                """
                CREATE TABLE IF NOT EXISTS transitions (
                    guild_id INTEGER NOT NULL,
                    prev TEXT NOT NULL,
                    next TEXT NOT NULL,
                    count INTEGER NOT NULL DEFAULT 1,
                    PRIMARY KEY (guild_id, prev, next)
                );
                CREATE TABLE IF NOT EXISTS settings (
                    guild_id INTEGER PRIMARY KEY,
                    frequency INTEGER NOT NULL,
                    min_words INTEGER NOT NULL,
                    max_words INTEGER NOT NULL,
                    reply_chance INTEGER NOT NULL,
                    learn_links INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS ignored_channels (
                    guild_id INTEGER NOT NULL,
                    channel_id INTEGER PRIMARY KEY
                );
                CREATE TABLE IF NOT EXISTS backfilled_channels (
                    guild_id INTEGER NOT NULL,
                    channel_id INTEGER PRIMARY KEY
                );
                """
            )
            columns = {row[1] for row in self._db.execute("PRAGMA table_info(settings)")}
            if "learn_links" not in columns:  # databases from before link support
                self._db.execute(
                    "ALTER TABLE settings ADD COLUMN learn_links INTEGER NOT NULL DEFAULT 1"
                )

    # ----- learning -------------------------------------------------------

    def learn(self, guild_id: int, text: str, keep_links: bool = True) -> bool:
        """Add a message to the guild's chain. Returns False if nothing was learned."""
        words = tokenize(text, keep_links)
        if not words:
            return False
        chain = [START, *words, END]
        pairs = [(guild_id, a, b) for a, b in zip(chain, chain[1:])]
        with self._lock, self._db:
            self._db.executemany(
                """
                INSERT INTO transitions (guild_id, prev, next) VALUES (?, ?, ?)
                ON CONFLICT (guild_id, prev, next) DO UPDATE SET count = count + 1
                """,
                pairs,
            )
        return True

    def forget(self, guild_id: int) -> None:
        with self._lock, self._db:
            self._db.execute("DELETE FROM transitions WHERE guild_id = ?", (guild_id,))

    def forget_links(self, guild_id: int) -> None:
        """Remove every learned link from a guild's chain."""
        with self._lock, self._db:
            self._db.execute(
                """
                DELETE FROM transitions WHERE guild_id = ? AND (
                    prev LIKE 'http://%' OR prev LIKE 'https://%'
                    OR next LIKE 'http://%' OR next LIKE 'https://%'
                )
                """,
                (guild_id,),
            )

    def stats(self, guild_id: int) -> tuple[int, int]:
        """Return (distinct words, messages learned) for a guild."""
        with self._lock:
            words = self._db.execute(
                "SELECT COUNT(DISTINCT prev) FROM transitions WHERE guild_id = ? AND prev != ?",
                (guild_id, START),
            ).fetchone()[0]
            messages = self._db.execute(
                "SELECT COALESCE(SUM(count), 0) FROM transitions WHERE guild_id = ? AND prev = ?",
                (guild_id, START),
            ).fetchone()[0]
        return words, messages

    # ----- generation -----------------------------------------------------

    def _next_options(self, guild_id: int, prev: str) -> list[tuple[str, int]]:
        with self._lock:
            return self._db.execute(
                "SELECT next, count FROM transitions WHERE guild_id = ? AND prev = ?",
                (guild_id, prev),
            ).fetchall()

    def _pick(self, options: list[tuple[str, int]], rng: random.Random) -> str:
        words = [w for w, _ in options]
        weights = [c for _, c in options]
        return rng.choices(words, weights=weights, k=1)[0]

    def generate(
        self,
        guild_id: int,
        min_words: int = 3,
        max_words: int = 25,
        rng: random.Random | None = None,
    ) -> str | None:
        """Build a mashup sentence of a random length between min_words and max_words.

        Returns None if the bot hasn't learned anything in this guild yet.
        """
        rng = rng or random.Random()
        if not self._next_options(guild_id, START):
            return None

        target = rng.randint(min_words, max_words)
        words: list[str] = []
        # 1-3 links per mashup (random), never the same one twice,
        # so chat doesn't fill up with embeds.
        link_cap = rng.randint(1, MAX_LINKS_PER_MASHUP)
        used_links: set[str] = set()
        prev = START
        # Guard against pathological chains that never make progress.
        for _ in range(max_words * 4):
            if len(words) >= target:
                break
            options = self._next_options(guild_id, prev)
            nxt = self._pick(options, rng) if options else END
            if is_link(nxt) and (nxt in used_links or len(used_links) >= link_cap):
                nxt = END
            if nxt == END:
                # Someone posted just an image/GIF link: repost it on its own,
                # the way the original message looked.
                if len(words) == 1 and is_link(words[0]):
                    break
                # Hit the end of a sentence before the target length:
                # jump to a fresh start word to keep the mashup going.
                prev = START
                continue
            words.append(nxt)
            if is_link(nxt):
                used_links.add(nxt)
            prev = nxt
        return " ".join(words) if words else None

    # ----- settings -------------------------------------------------------

    def get_settings(self, guild_id: int) -> GuildSettings:
        with self._lock:
            row = self._db.execute(
                "SELECT frequency, min_words, max_words, reply_chance, learn_links"
                " FROM settings WHERE guild_id = ?",
                (guild_id,),
            ).fetchone()
        if row is None:
            return GuildSettings(guild_id)
        return GuildSettings(guild_id, *row[:4], learn_links=bool(row[4]))

    def save_settings(self, s: GuildSettings) -> None:
        with self._lock, self._db:
            self._db.execute(
                """
                INSERT INTO settings
                    (guild_id, frequency, min_words, max_words, reply_chance, learn_links)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (guild_id) DO UPDATE SET
                    frequency = excluded.frequency,
                    min_words = excluded.min_words,
                    max_words = excluded.max_words,
                    reply_chance = excluded.reply_chance,
                    learn_links = excluded.learn_links
                """,
                (
                    s.guild_id,
                    s.frequency,
                    s.min_words,
                    s.max_words,
                    s.reply_chance,
                    int(s.learn_links),
                ),
            )

    def is_ignored(self, channel_id: int) -> bool:
        with self._lock:
            return (
                self._db.execute(
                    "SELECT 1 FROM ignored_channels WHERE channel_id = ?", (channel_id,)
                ).fetchone()
                is not None
            )

    def toggle_ignored(self, guild_id: int, channel_id: int) -> bool:
        """Flip whether a channel is ignored. Returns the new ignored state."""
        with self._lock, self._db:
            cur = self._db.execute(
                "DELETE FROM ignored_channels WHERE channel_id = ?", (channel_id,)
            )
            if cur.rowcount:
                return False
            self._db.execute(
                "INSERT INTO ignored_channels (guild_id, channel_id) VALUES (?, ?)",
                (guild_id, channel_id),
            )
            return True

    def is_backfilled(self, channel_id: int) -> bool:
        with self._lock:
            return (
                self._db.execute(
                    "SELECT 1 FROM backfilled_channels WHERE channel_id = ?", (channel_id,)
                ).fetchone()
                is not None
            )

    def mark_backfilled(self, guild_id: int, channel_id: int) -> None:
        with self._lock, self._db:
            self._db.execute(
                "INSERT OR IGNORE INTO backfilled_channels (guild_id, channel_id) VALUES (?, ?)",
                (guild_id, channel_id),
            )

    def close(self) -> None:
        self._db.close()


# ---------------------------------------------------------------------------
# Claude chat (when someone @mentions the bot or replies to it)
# ---------------------------------------------------------------------------

SYSTEM_PROMPT = """\
You are Weididdy Bot, a member of a Discord server. You're chatty, funny and a \
little chaotic, but actually helpful when someone asks a real question.

You'll see the recent channel conversation, with each message prefixed by the \
sender's display name. Reply to the latest message that mentions or replies to \
you. Write like a person in a group chat: short, casual, Discord markdown is \
fine. Keep replies under 1500 characters unless someone asks for something long. \
Use web search when a question needs current or factual info you aren't sure \
of. Don't prefix your reply with your own name."""

IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024  # API limit per image
MAX_IMAGES = 4
MAX_PAUSE_RESUMES = 3


class ClaudeChat:
    def __init__(self, model: str, effort: str, history_limit: int) -> None:
        self.client = anthropic.AsyncAnthropic()
        self.model = model
        self.effort = effort
        self.history_limit = history_limit

    async def _image_blocks(self, message: discord.Message) -> list[dict]:
        blocks: list[dict] = []
        for att in message.attachments:
            ctype = (att.content_type or "").split(";")[0]
            if ctype not in IMAGE_TYPES or att.size > MAX_IMAGE_BYTES:
                continue
            data = await att.read()
            blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": ctype,
                        "data": base64.standard_b64encode(data).decode("ascii"),
                    },
                }
            )
            if len(blocks) >= MAX_IMAGES:
                break
        return blocks

    async def build_messages(
        self, trigger: discord.Message, me: discord.abc.User
    ) -> list[dict]:
        """Turn recent channel history into a Claude conversation.

        The bot's own replies become assistant turns; everyone else's messages
        become user turns prefixed with their name. The bot's random mashup
        posts are skipped so they don't confuse the conversation.
        """
        history = [
            m
            async for m in trigger.channel.history(
                limit=self.history_limit, before=trigger
            )
        ]
        history.reverse()

        messages: list[dict] = []
        for m in [*history, trigger]:
            if m.author.id == me.id:
                if m.reference is None or not m.content:
                    continue  # a mashup post, not a chat reply
                messages.append({"role": "assistant", "content": m.content})
                continue
            text = m.clean_content.strip()
            if m.attachments and m is not trigger:
                text += " [attached a file]"
            if not text and m is not trigger:
                continue
            content: list[dict] = []
            if m is trigger:
                content.extend(await self._image_blocks(m))
            content.append(
                {"type": "text", "text": f"{m.author.display_name}: {text or '(no text)'}"}
            )
            messages.append({"role": "user", "content": content})

        # The conversation must open with a user turn.
        while messages and messages[0]["role"] == "assistant":
            messages.pop(0)
        return messages

    async def reply(self, trigger: discord.Message, me: discord.abc.User) -> str:
        messages = await self.build_messages(trigger, me)

        parts: list[str] = []
        for _ in range(MAX_PAUSE_RESUMES + 1):
            response = await self.client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                messages=messages,
                thinking={"type": "adaptive"},
                output_config={"effort": self.effort},
                tools=[
                    {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}
                ],
                # If Claude's safety filter declines, retry server-side on the
                # model Anthropic recommends instead of failing outright.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
            if response.stop_reason == "refusal":
                return "nah, I can't help with that one."
            parts.extend(b.text for b in response.content if b.type == "text")
            if response.stop_reason != "pause_turn":
                break
            # A long web search paused mid-turn: send it back to resume.
            messages = [*messages, {"role": "assistant", "content": response.content}]

        text = "".join(parts).strip()
        return text or "...I got nothing. Try asking again?"


# ---------------------------------------------------------------------------
# Custom replies matching
# ---------------------------------------------------------------------------

@lru_cache(maxsize=None)
def _pattern(trigger: str) -> re.Pattern[str]:
    # (?<!\w) / (?!\w) = whole words only, but still works with emoji and punctuation.
    return re.compile(r"(?<!\w)" + re.escape(trigger.strip()) + r"(?!\w)", re.IGNORECASE)


def find_reply(text: str, user: str) -> str | None:
    """Return the reply for the first trigger found in text, or None."""
    for trigger, reply in CUSTOM_REPLIES.items():
        if trigger.strip() and _pattern(trigger).search(text):
            if isinstance(reply, (list, tuple)):
                reply = random.choice(reply)
            return str(reply).replace("{user}", user)
    return None


# ---------------------------------------------------------------------------
# The Discord bot
# ---------------------------------------------------------------------------

NO_PINGS = discord.AllowedMentions.none()
DISCORD_LIMIT = 2000
MEDIA_PREFIXES = ("image/", "video/")


def split_message(text: str, limit: int = DISCORD_LIMIT) -> list[str]:
    """Split text into Discord-sized chunks, preferring line breaks."""
    chunks: list[str] = []
    while len(text) > limit:
        cut = text.rfind("\n", 0, limit)
        if cut <= 0:
            cut = text.rfind(" ", 0, limit)
        if cut <= 0:
            cut = limit
        chunks.append(text[:cut])
        text = text[cut:].lstrip()
    if text:
        chunks.append(text)
    return chunks


def learnable_text(message: discord.Message, include_media: bool) -> str:
    """Message text plus, optionally, links to its uploaded images/GIFs/videos
    so they can be reposted later as embeds."""
    text = message.content
    if include_media:
        text += "".join(
            f" {a.url}"
            for a in message.attachments
            if (a.content_type or "").startswith(MEDIA_PREFIXES)
        )
    return text


class WeididdyBot(discord.Client):
    def __init__(
        self,
        store: MarkovStore,
        chat: ClaudeChat | None,
        dev_guild: int | None,
        history_limit: int = 500,
    ):
        intents = discord.Intents.default()
        intents.message_content = True  # privileged: enable it in the Developer Portal
        super().__init__(intents=intents, allowed_mentions=NO_PINGS)
        self.tree = app_commands.CommandTree(self)
        self.store = store
        self.chat = chat
        self.dev_guild = dev_guild
        self.counters: dict[int, int] = defaultdict(int)  # channel id -> messages since last post
        self.history_limit = history_limit
        self._backfilling: set[int] = set()
        register_commands(self)

    async def setup_hook(self) -> None:
        if self.dev_guild:
            guild = discord.Object(id=self.dev_guild)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()

    async def on_ready(self) -> None:
        log.info("Logged in as %s (%s)", self.user, self.user.id)
        for guild in self.guilds:
            await self.backfill_guild(guild)

    async def on_guild_join(self, guild: discord.Guild) -> None:
        await self.backfill_guild(guild)

    async def backfill_guild(self, guild: discord.Guild) -> None:
        """Learn from recent history in every channel not read before.

        Each channel is only read once (tracked in the database), so restarts
        don't learn the same messages twice.
        """
        if self.history_limit <= 0:
            return
        for channel in guild.text_channels:
            perms = channel.permissions_for(guild.me)
            if not (perms.view_channel and perms.read_message_history):
                continue
            if (
                channel.id in self._backfilling
                or self.store.is_backfilled(channel.id)
                or self.store.is_ignored(channel.id)
            ):
                continue
            self._backfilling.add(channel.id)
            try:
                learned = await self._backfill_channel(channel)
            except discord.HTTPException:
                log.exception("Couldn't read history in #%s (%s)", channel.name, guild.name)
                continue
            finally:
                self._backfilling.discard(channel.id)
            self.store.mark_backfilled(guild.id, channel.id)
            log.info("Learned %d old messages from #%s (%s)", learned, channel.name, guild.name)

    async def _backfill_channel(self, channel: discord.TextChannel) -> int:
        settings = self.store.get_settings(channel.guild.id)
        # Messages arriving from now on are learned live by on_message.
        before = discord.utils.utcnow()
        learned = 0
        async for message in channel.history(limit=self.history_limit, before=before):
            if message.author.bot or self.user in message.mentions:
                continue
            if self.store.learn(
                channel.guild.id, learnable_text(message, settings.learn_links), settings.learn_links
            ):
                learned += 1
        return learned

    def _is_for_me(self, message: discord.Message) -> bool:
        if self.user in message.mentions:
            return True
        ref = message.reference
        return (
            ref is not None
            and isinstance(ref.resolved, discord.Message)
            and ref.resolved.author.id == self.user.id
        )

    async def on_message(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return

        if self._is_for_me(message):
            await self._chat_reply(message)
            return

        if self.store.is_ignored(message.channel.id):
            return

        custom = find_reply(message.content, message.author.display_name)
        if custom:
            await message.reply(custom[:DISCORD_LIMIT])

        settings = self.store.get_settings(message.guild.id)
        text = learnable_text(message, settings.learn_links)
        if not self.store.learn(message.guild.id, text, settings.learn_links):
            return

        self.counters[message.channel.id] += 1
        due = settings.frequency > 0 and self.counters[message.channel.id] >= settings.frequency
        lucky = settings.reply_chance > 0 and random.randint(1, 100) <= settings.reply_chance
        if due or lucky:
            self.counters[message.channel.id] = 0
            text = self.store.generate(
                message.guild.id, settings.min_words, settings.max_words
            )
            if text:
                await message.channel.send(text[:DISCORD_LIMIT])

    async def _chat_reply(self, message: discord.Message) -> None:
        if self.chat is None:
            text = self.store.generate(message.guild.id) or "I don't know any words yet!"
            await message.reply(text[:DISCORD_LIMIT])
            return
        try:
            async with message.channel.typing():
                text = await self.chat.reply(message, self.user)
        except anthropic.RateLimitError:
            text = "I'm being rate limited right now, try again in a minute."
        except anthropic.APIStatusError as e:
            log.exception("Claude API error (request id %s)", e.request_id)
            text = "Something went wrong talking to my brain. Try again?"
        except anthropic.APIConnectionError:
            log.exception("Could not reach the Claude API")
            text = "I can't reach my brain right now. Try again in a bit."

        # Every chunk is a reply so chat history can tell chat replies from mashups.
        for chunk in split_message(text):
            await message.reply(chunk)


def register_commands(bot: WeididdyBot) -> None:
    tree = bot.tree
    store = bot.store

    @tree.command(description="Post a random mashup of words this server has said")
    @app_commands.guild_only()
    async def generate(interaction: discord.Interaction) -> None:
        s = store.get_settings(interaction.guild_id)
        text = store.generate(interaction.guild_id, s.min_words, s.max_words)
        await interaction.response.send_message(
            text[:DISCORD_LIMIT] if text else "I haven't learned any words here yet!"
        )

    @tree.command(description="Set how many messages between automatic mashups (0 = off)")
    @app_commands.describe(messages="Post a mashup every this many messages (0 turns it off)")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def frequency(
        interaction: discord.Interaction, messages: app_commands.Range[int, 0, 1000]
    ) -> None:
        s = store.get_settings(interaction.guild_id)
        s.frequency = messages
        store.save_settings(s)
        msg = (
            "Automatic mashups are off."
            if messages == 0
            else f"I'll post a mashup every **{messages}** messages."
        )
        await interaction.response.send_message(msg)

    @tree.command(description="Set how short or long mashups can be")
    @app_commands.describe(min_words="Shortest mashup, in words", max_words="Longest mashup, in words")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def length(
        interaction: discord.Interaction,
        min_words: app_commands.Range[int, 1, 200],
        max_words: app_commands.Range[int, 1, 200],
    ) -> None:
        if min_words > max_words:
            min_words, max_words = max_words, min_words
        s = store.get_settings(interaction.guild_id)
        s.min_words, s.max_words = min_words, max_words
        store.save_settings(s)
        await interaction.response.send_message(
            f"Mashups will be **{min_words}–{max_words}** words long."
        )

    @tree.command(description="Set a % chance to post a mashup on any message")
    @app_commands.describe(percent="0–100; on top of the regular frequency")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def chance(
        interaction: discord.Interaction, percent: app_commands.Range[int, 0, 100]
    ) -> None:
        s = store.get_settings(interaction.guild_id)
        s.reply_chance = percent
        store.save_settings(s)
        await interaction.response.send_message(
            f"Random mashup chance set to **{percent}%** per message."
        )

    @tree.command(description="Stop (or start again) learning and posting in this channel")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def ignore(interaction: discord.Interaction) -> None:
        ignored = store.toggle_ignored(interaction.guild_id, interaction.channel_id)
        msg = (
            "I'll ignore this channel from now on."
            if ignored
            else "I'm listening to this channel again."
        )
        await interaction.response.send_message(msg)

    @tree.command(description="Show what Weididdy Bot has learned here and its settings")
    @app_commands.guild_only()
    async def stats(interaction: discord.Interaction) -> None:
        s = store.get_settings(interaction.guild_id)
        words, messages = store.stats(interaction.guild_id)
        freq = "off" if s.frequency == 0 else f"every {s.frequency} messages"
        await interaction.response.send_message(
            f"**Learned:** {words:,} words from {messages:,} messages\n"
            f"**Auto mashups:** {freq}\n"
            f"**Random chance:** {s.reply_chance}%\n"
            f"**Links & images:** {'on' if s.learn_links else 'off'}\n"
            f"**Length:** {s.min_words}–{s.max_words} words\n"
            f"**This channel:** {'ignored' if store.is_ignored(interaction.channel_id) else 'listening'}"
        )

    @tree.command(description="Turn learning and reposting links, images and GIFs on or off")
    @app_commands.describe(enabled="On: repost links/images like GenAI. Off: words only")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def links(interaction: discord.Interaction, enabled: bool) -> None:
        s = store.get_settings(interaction.guild_id)
        s.learn_links = enabled
        store.save_settings(s)
        if enabled:
            msg = "I'll learn and repost links, images and GIFs."
        else:
            store.forget_links(interaction.guild_id)
            msg = "Links are off, and I've forgotten the ones I learned. Words only now."
        await interaction.response.send_message(msg)

    @tree.command(description="Wipe every word Weididdy Bot has learned in this server")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def forget(interaction: discord.Interaction) -> None:
        store.forget(interaction.guild_id)
        await interaction.response.send_message("Memory wiped. I know nothing now. 🫥")



def ask_for_tokens(env_path: Path) -> None:
    """First run: ask for the tokens and save them to .env next to this script."""
    print("\nNo Discord bot token found. Let's set it up (you only do this once).")
    print("Get it from https://discord.com/developers/applications -> your app -> Bot -> Reset Token.\n")
    token = ""
    while not token:
        token = input("Paste your Discord bot token and press Enter: ").strip().strip('"')
    key = input(
        "Paste your Claude API key for AI chat (or just press Enter to skip): "
    ).strip().strip('"')
    lines = [f"DISCORD_TOKEN={token}"]
    if key:
        lines.append(f"ANTHROPIC_API_KEY={key}")
    env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.environ["DISCORD_TOKEN"] = token
    if key:
        os.environ["ANTHROPIC_API_KEY"] = key
    print(f"Saved to {env_path}. Edit or delete that file to change them.\n")


def main() -> None:
    env_path = HERE / ".env"
    load_dotenv(env_path)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    if not os.environ.get("DISCORD_TOKEN"):
        ask_for_tokens(env_path)
    token = os.environ["DISCORD_TOKEN"]

    store = MarkovStore(os.environ.get("WEIDIDDY_DB", str(HERE / "weididdy.db")))

    chat: ClaudeChat | None = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        chat = ClaudeChat(
            model=os.environ.get("CLAUDE_MODEL", "claude-opus-5"),
            effort=os.environ.get("CLAUDE_EFFORT", "medium"),
            history_limit=int(os.environ.get("CHAT_HISTORY", "20")),
        )
    else:
        log.warning("No Claude API key: @mentions will get a mashup instead of an AI reply.")

    dev_guild = os.environ.get("DEV_GUILD_ID")
    bot = WeididdyBot(
        store,
        chat,
        int(dev_guild) if dev_guild else None,
        history_limit=int(os.environ.get("LEARN_HISTORY", "500")),
    )
    try:
        bot.run(token, log_handler=None)
    except discord.LoginFailure:
        print("\nDiscord rejected the token. Delete the .env file next to this script")
        print("and start the bot again to enter a new one.")
    except discord.PrivilegedIntentsRequired:
        print("\nTurn on 'Message Content Intent' in the Discord Developer Portal")
        print("(your app -> Bot -> Privileged Gateway Intents), then start the bot again.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        log.exception("The bot crashed")
    # Keep the window open when started by double-clicking, so errors can be read.
    if sys.stdin and sys.stdin.isatty():
        input("\nBot stopped. Press Enter to close...")
