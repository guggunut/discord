"""Claude-powered replies for when someone @mentions the bot or replies to it."""

from __future__ import annotations

import base64
import logging

import anthropic
import discord

log = logging.getLogger(__name__)

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
