import random

from weididdy.bot import split_message
from weididdy.markov import MarkovStore, tokenize


def make_store(tmp_path):
    return MarkovStore(str(tmp_path / "test.db"))


def test_tokenize_strips_pings_and_links():
    text = "hey <@123> and <@!456> in <#789> @everyone look https://x.com/a lol"
    assert tokenize(text) == ["hey", "and", "in", "look", "lol"]


def test_tokenize_keeps_custom_emoji():
    assert tokenize("nice <:pog:1234>") == ["nice", "<:pog:1234>"]


def test_generate_empty_guild_returns_none(tmp_path):
    assert make_store(tmp_path).generate(1) is None


def test_generate_uses_only_learned_words_and_respects_length(tmp_path):
    store = make_store(tmp_path)
    for msg in ["the cat sat on the mat", "a dog ate the cat food", "lol ok"]:
        store.learn(1, msg)
    vocab = {"the", "cat", "sat", "on", "mat", "a", "dog", "ate", "food", "lol", "ok"}
    rng = random.Random(0)
    for _ in range(50):
        out = store.generate(1, min_words=2, max_words=12, rng=rng)
        words = out.split()
        assert 2 <= len(words) <= 12
        assert set(words) <= vocab


def test_guilds_are_isolated(tmp_path):
    store = make_store(tmp_path)
    store.learn(1, "alpha beta")
    store.learn(2, "gamma delta")
    for _ in range(20):
        assert set(store.generate(1, 1, 5).split()) <= {"alpha", "beta"}
    store.forget(1)
    assert store.generate(1) is None
    assert store.generate(2) is not None


def test_stats_and_settings_roundtrip(tmp_path):
    store = make_store(tmp_path)
    store.learn(1, "one two")
    store.learn(1, "one three")
    assert store.stats(1) == (3, 2)

    s = store.get_settings(1)
    assert s.frequency == 10
    s.frequency, s.min_words, s.max_words, s.reply_chance = 5, 2, 8, 15
    store.save_settings(s)
    assert store.get_settings(1) == s


def test_toggle_ignored(tmp_path):
    store = make_store(tmp_path)
    assert store.toggle_ignored(1, 99) is True
    assert store.is_ignored(99)
    assert store.toggle_ignored(1, 99) is False
    assert not store.is_ignored(99)


def test_split_message():
    text = "word " * 1000
    chunks = split_message(text, limit=100)
    assert all(len(c) <= 100 for c in chunks)
    assert " ".join(chunks).split() == text.split()
