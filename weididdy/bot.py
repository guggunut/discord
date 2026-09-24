"""Weididdy Bot: learns words from chat, posts mashups, and chats via Claude."""

from __future__ import annotations

import logging
import os
import random
from collections import defaultdict

import anthropic
import discord
from discord import app_commands
from dotenv import load_dotenv

from .chat import ClaudeChat
from .markov import MarkovStore

log = logging.getLogger("weididdy")

NO_PINGS = discord.AllowedMentions.none()
DISCORD_LIMIT = 2000


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


class WeididdyBot(discord.Client):
    def __init__(self, store: MarkovStore, chat: ClaudeChat | None, dev_guild: int | None):
        intents = discord.Intents.default()
        intents.message_content = True  # privileged: enable it in the Developer Portal
        super().__init__(intents=intents, allowed_mentions=NO_PINGS)
        self.tree = app_commands.CommandTree(self)
        self.store = store
        self.chat = chat
        self.dev_guild = dev_guild
        self.counters: dict[int, int] = defaultdict(int)  # channel id -> messages since last post
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
        if not self.store.learn(message.guild.id, message.content):
            return

        settings = self.store.get_settings(message.guild.id)
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
            f"**Length:** {s.min_words}–{s.max_words} words\n"
            f"**This channel:** {'ignored' if store.is_ignored(interaction.channel_id) else 'listening'}"
        )

    @tree.command(description="Wipe every word Weididdy Bot has learned in this server")
    @app_commands.guild_only()
    @app_commands.default_permissions(manage_guild=True)
    async def forget(interaction: discord.Interaction) -> None:
        store.forget(interaction.guild_id)
        await interaction.response.send_message("Memory wiped. I know nothing now. 🫥")


def main() -> None:
    load_dotenv()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    token = os.environ.get("DISCORD_TOKEN")
    if not token:
        raise SystemExit("Set DISCORD_TOKEN in your environment or .env file.")

    store = MarkovStore(os.environ.get("WEIDIDDY_DB", "weididdy.db"))

    chat: ClaudeChat | None = None
    if os.environ.get("ANTHROPIC_API_KEY"):
        chat = ClaudeChat(
            model=os.environ.get("CLAUDE_MODEL", "claude-opus-5"),
            effort=os.environ.get("CLAUDE_EFFORT", "medium"),
            history_limit=int(os.environ.get("CHAT_HISTORY", "20")),
        )
    else:
        log.warning("ANTHROPIC_API_KEY not set: @mentions will get a mashup instead of an AI reply.")

    dev_guild = os.environ.get("DEV_GUILD_ID")
    bot = WeididdyBot(store, chat, int(dev_guild) if dev_guild else None)
    bot.run(token, log_handler=None)
