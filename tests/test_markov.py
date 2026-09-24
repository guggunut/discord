import random
import sqlite3

from weididdy.bot import split_message
from weididdy.markov import MarkovStore, tokenize


def make_store(tmp_path):
    return MarkovStore(str(tmp_path / "test.db"))


def test_tokenize_strips_pings_keeps_links():
    text = "hey <@123> and <@!456> in <#789> @everyone look https://x.com/a.gif lol"
    assert tokenize(text) == ["hey", "and", "in", "look", "https://x.com/a.gif", "lol"]


def test_tokenize_can_drop_links():
    assert tokenize("look https://x.com/a.gif lol", keep_links=False) == ["look", "lol"]


def test_long_links_are_kept_but_long_words_are_not():
    link = "https://cdn.discordapp.com/attachments/1/2/cat.png?ex=abc&is=def&hm=" + "f" * 64
    assert tokenize(f"{link} {'a' * 60}") == [link]


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
    assert s.learn_links is True
    s.frequency, s.min_words, s.max_words, s.reply_chance = 5, 2, 8, 15
    s.learn_links = False
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


def test_lone_link_is_reposted_on_its_own(tmp_path):
    store = make_store(tmp_path)
    store.learn(1, "https://tenor.com/view/funny-cat-gif-123")
    assert store.generate(1, min_words=3, max_words=10) == "https://tenor.com/view/funny-cat-gif-123"


def test_links_mix_into_mashups(tmp_path):
    store = make_store(tmp_path)
    store.learn(1, "check this https://i.imgur.com/cat.png so funny")
    rng = random.Random(1)
    outputs = {store.generate(1, 3, 10, rng=rng) for _ in range(20)}
    assert any("https://i.imgur.com/cat.png" in o for o in outputs)


def test_forget_links_keeps_words(tmp_path):
    store = make_store(tmp_path)
    store.learn(1, "check this https://i.imgur.com/cat.png so funny")
    store.forget_links(1)
    for _ in range(20):
        assert "http" not in store.generate(1, 1, 10)


def test_old_database_gets_links_column(tmp_path):
    path = tmp_path / "old.db"
    db = sqlite3.connect(path)
    db.execute(
        "CREATE TABLE settings (guild_id INTEGER PRIMARY KEY, frequency INTEGER NOT NULL,"
        " min_words INTEGER NOT NULL, max_words INTEGER NOT NULL, reply_chance INTEGER NOT NULL)"
    )
    db.execute("INSERT INTO settings VALUES (1, 7, 2, 9, 0)")
    db.commit()
    db.close()
    s = MarkovStore(str(path)).get_settings(1)
    assert (s.frequency, s.learn_links) == (7, True)


def test_one_to_three_distinct_links_per_mashup(tmp_path):
    store = make_store(tmp_path)
    for i in range(10):
        store.learn(1, "lol look")
        store.learn(1, f"https://cdn.discordapp.com/attachments/1/2/cat{i}.gif")
    rng = random.Random(2)
    link_counts = set()
    for _ in range(200):
        links = [w for w in store.generate(1, 10, 25, rng=rng).split() if w.startswith("https://")]
        assert len(links) == len(set(links))  # never the same link twice
        assert len(links) <= 3
        link_counts.add(len(links))
    assert {1, 2, 3} <= link_counts  # the cap really varies
