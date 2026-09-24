"""Word-mashup generator: learns word transitions from chat and remixes them.

Each server (guild) has its own word chain stored in SQLite, so what the bot
says in one server never leaks into another.
"""

from __future__ import annotations

import random
import re
import sqlite3
import threading
from dataclasses import dataclass

# Control-character markers for "start of message" and "end of message";
# tokenize() strips them from real words so they can't collide.
START = "\x02"
END = "\x03"

_MENTION_RE = re.compile(r"<(@[!&]?|#)\d+>")
_URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
_EVERYONE_RE = re.compile(r"@(everyone|here)", re.IGNORECASE)

MAX_WORD_LEN = 40


@dataclass
class GuildSettings:
    guild_id: int
    frequency: int = 10  # post a mashup every N learned messages; 0 = never
    min_words: int = 3
    max_words: int = 25
    reply_chance: int = 0  # extra % chance to post on any message


def tokenize(text: str) -> list[str]:
    """Split a Discord message into learnable words.

    Mentions and links are dropped so the bot never pings
    anyone or reposts links; @everyone/@here are stripped too.
    """
    text = _MENTION_RE.sub(" ", text)
    text = _URL_RE.sub(" ", text)
    text = _EVERYONE_RE.sub(" ", text)
    text = text.replace(START, " ").replace(END, " ")
    return [w for w in text.split() if len(w) <= MAX_WORD_LEN]


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
                    reply_chance INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS ignored_channels (
                    guild_id INTEGER NOT NULL,
                    channel_id INTEGER PRIMARY KEY
                );
                """
            )

    # ----- learning -------------------------------------------------------

    def learn(self, guild_id: int, text: str) -> bool:
        """Add a message to the guild's chain. Returns False if nothing was learned."""
        words = tokenize(text)
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
        prev = START
        # Guard against pathological chains that never make progress.
        for _ in range(max_words * 4):
            if len(words) >= target:
                break
            options = self._next_options(guild_id, prev)
            nxt = self._pick(options, rng) if options else END
            if nxt == END:
                # Hit the end of a sentence before the target length:
                # jump to a fresh start word to keep the mashup going.
                prev = START
                continue
            words.append(nxt)
            prev = nxt
        return " ".join(words) if words else None

    # ----- settings -------------------------------------------------------

    def get_settings(self, guild_id: int) -> GuildSettings:
        with self._lock:
            row = self._db.execute(
                "SELECT frequency, min_words, max_words, reply_chance FROM settings WHERE guild_id = ?",
                (guild_id,),
            ).fetchone()
        if row is None:
            return GuildSettings(guild_id)
        return GuildSettings(guild_id, *row)

    def save_settings(self, s: GuildSettings) -> None:
        with self._lock, self._db:
            self._db.execute(
                """
                INSERT INTO settings (guild_id, frequency, min_words, max_words, reply_chance)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (guild_id) DO UPDATE SET
                    frequency = excluded.frequency,
                    min_words = excluded.min_words,
                    max_words = excluded.max_words,
                    reply_chance = excluded.reply_chance
                """,
                (s.guild_id, s.frequency, s.min_words, s.max_words, s.reply_chance),
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

    def close(self) -> None:
        self._db.close()
