"""Custom replies: when someone says a trigger phrase, the bot answers.

HOW TO ADD YOUR OWN
-------------------
Add a line inside CUSTOM_REPLIES below, in this shape:

    "trigger phrase": "what the bot says back",

- Matching ignores capitals, and the phrase can be anywhere in the message.
  It only matches whole words, so "hi" won't fire on "this" or "high".
- For a random pick, use a list of replies:  "gm": ["gm", "morning", "go back to bed"],
- Put {user} in a reply to include the person's name (it won't ping them).
- Every line needs a comma at the end. Restart the bot after editing.
"""

CUSTOM_REPLIES = {
    "good morning": ["gm {user} ☀️", "morning!!", "go back to bed"],
    "good night": "gn {user} 😴",
    "who is weididdy": "the greatest bot to ever live",
    "ping": "pong 🏓",
}


# ---------------------------------------------------------------------------
# You don't need to change anything below this line.
# ---------------------------------------------------------------------------

import random
import re
from functools import lru_cache


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
