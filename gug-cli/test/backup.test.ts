import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "gug-backup-"));
process.env.GUG_DATA = dir;
const { Store } = await import("../src/server/store.ts");
const { vaultSet, vaultGet } = await import("../src/server/local.ts");
const { makeBackup, restoreBackup } = await import("../src/server/backup.ts");
const { validateStream, validateEntry } = await import("../src/server/ventures.ts");
const { validatePost } = await import("../src/server/growth.ts");

test("backups round-trip your data but never your keys", () => {
  const store = new Store(path.join(dir, "db.json"));
  vaultSet(store, "anthropic", "sk-ant-secret-value-123");
  const s = validateStream({ name: "Shop", kind: "shopify" });
  store.data.ventures.streams.push(s);
  store.data.ventures.entries.push(validateEntry(store.data.ventures, { streamId: s.id, date: "2026-10-01", amount: 50 }));
  store.data.growth.posts.push(validatePost({ date: "2026-10-02", title: "Reel" }));
  store.data.chats.atlas = [{ role: "user", content: "hi", at: "" }];

  const b = makeBackup(store, { chats: false });
  const text = JSON.stringify(b);
  assert.ok(!text.includes("sk-ant-secret"), "no plaintext key");
  assert.ok(!text.includes('"secrets"'), "no sealed secrets either");
  assert.equal(b.chats, undefined, "chats only when asked");

  // Wipe, add junk, then restore.
  store.data.ventures = { currency: "USD", streams: [], entries: [] };
  store.data.growth.posts = [];
  const tampered = JSON.parse(text);
  tampered.growth.posts.push({ date: "not a date", title: "bad" });
  tampered.studio.art.push({ title: "evil", svg: '<svg onload="steal()"><script>x()</script><rect/></svg>' });
  tampered.markets.watch.push({ symbol: "../../etc", kind: "stock" });
  const r = restoreBackup(store, tampered);
  assert.equal(r.streams, 1);
  assert.equal(r.entries, 1);
  assert.equal(r.posts, 1);
  assert.equal(r.art, 1);
  assert.equal(r.skipped, 2, "the bad post and the bad ticker are dropped");
  assert.equal(store.data.ventures.entries[0].streamId, store.data.ventures.streams[0].id, "entries follow their stream's new id");
  assert.equal(vaultGet(store, "anthropic"), "sk-ant-secret-value-123", "keys untouched by restore");
  assert.equal(store.data.chats.atlas.length, 1, "chats kept when the backup has none");
});

test("foreign files are refused", () => {
  const store = new Store(path.join(dir, "db2.json"));
  assert.throws(() => restoreBackup(store, { hello: "world" }), /isn't a GUG-cli backup/);
});
