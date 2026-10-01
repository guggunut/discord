import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-roblox-"));
const fake = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  if (req.url === "/universes/v1/places/920587237/universe") return res.end(JSON.stringify({ universeId: 3317771874 }));
  if (req.url?.startsWith("/universes/v1/places/")) return (res.statusCode = 404), res.end("{}");
  if (req.url === "/v1/games?universeIds=3317771874") return res.end(JSON.stringify({ data: [{ id: 3317771874, name: "Sky Obby", playing: 42, visits: 182400, favoritedCount: 900, updated: "2026-09-30T10:00:00Z" }] }));
  if (req.url === "/v1/games/votes?universeIds=3317771874") return res.end(JSON.stringify({ data: [{ id: 3317771874, upVotes: 120, downVotes: 8 }] }));
  res.statusCode = 404;
  res.end("{}");
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
process.env.GUG_ROBLOX_APIS_URL = base;
process.env.GUG_ROBLOX_GAMES_URL = base;
after(() => fake.close());

const { parsePlaceId, recordSnapshot, robloxStats, universeFor } = await import("../src/server/roblox.ts");
const { Store } = await import("../src/server/store.ts");

test("place IDs come from links or plain numbers", () => {
  assert.equal(parsePlaceId("https://www.roblox.com/games/920587237/Sky-Obby"), 920587237);
  assert.equal(parsePlaceId("920587237"), 920587237);
  assert.throws(() => parsePlaceId("my game"), /place ID/);
});

test("stats come from the public games APIs and snapshot once a day", async () => {
  const u = await universeFor(920587237);
  assert.equal(u, 3317771874);
  await assert.rejects(universeFor(111111), /doesn't know/);
  const s = await robloxStats(u);
  assert.deepEqual([s.name, s.playing, s.visits, s.favorites, s.upVotes, s.downVotes], ["Sky Obby", 42, 182400, 900, 120, 8]);
  const store = new Store(path.join(process.env.GUG_DATA!, "db.json"));
  recordSnapshot(store, "st1", s);
  recordSnapshot(store, "st1", { ...s, visits: 182500 });
  assert.equal(store.data.robloxHistory.st1.length, 1, "same day replaces");
  assert.equal(store.data.robloxHistory.st1[0].visits, 182500);
  recordSnapshot(store, "st1", { ...s, at: "2099-01-02T00:00:00.000Z" });
  assert.equal(store.data.robloxHistory.st1.length, 2);
});
