import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-ventures-"));
const { emptyVentures, sampleData, summarise, validateEntry, validateStream } = await import("../src/server/ventures.ts");

const now = new Date(2026, 9, 1, 12);

test("streams and entries are validated", () => {
  assert.throws(() => validateStream({ name: "" }), /name/);
  assert.throws(() => validateStream({ name: "Game", kind: "roblox", rate: 5 }), /Robux rate/);
  const game = validateStream({ name: "Game", kind: "roblox" });
  assert.equal(game.robux, true);
  const v = { ...emptyVentures(), streams: [game] };
  assert.throws(() => validateEntry(v, { streamId: "nope", date: "2026-10-01", amount: 5 }), /stream/);
  assert.throws(() => validateEntry(v, { streamId: game.id, date: "01/10/2026", amount: 5 }), /date/);
  assert.throws(() => validateEntry(v, { streamId: game.id, date: "2026-10-01", amount: -5 }), /more than zero/);
  const e = validateEntry(v, { streamId: game.id, date: "2026-10-01", type: "cost", amount: 9.999, orders: 4 });
  assert.equal(e.amount, 10);
  assert.equal(e.orders, 0, "costs never count as orders");
});

test("summary converts Robux, nets costs and refunds, and compares periods", () => {
  const shop = validateStream({ name: "Shop", kind: "shopify" });
  const game = validateStream({ name: "Game", kind: "roblox", rate: 0.01 });
  const v = { ...emptyVentures(), streams: [shop, game] };
  const add = (x: object) => v.entries.push(validateEntry(v, x));
  add({ streamId: shop.id, date: "2026-10-01", type: "sale", amount: 100, orders: 2 });
  add({ streamId: shop.id, date: "2026-09-30", type: "cost", amount: 30 });
  add({ streamId: shop.id, date: "2026-09-29", type: "refund", amount: 10 });
  add({ streamId: game.id, date: "2026-09-28", type: "sale", amount: 5000, orders: 10 }); // 5000 R$ × 0.01 = 50
  add({ streamId: shop.id, date: "2026-09-20", type: "sale", amount: 40, orders: 1 }); // previous 7-day window
  add({ streamId: shop.id, date: "2026-11-01", type: "sale", amount: 999 }); // future: ignored
  const s = summarise(v, "7d", now);
  assert.equal(s.from, "2026-09-25");
  assert.equal(s.kpis.revenue.value, 150);
  assert.equal(s.kpis.profit.value, 110);
  assert.equal(s.kpis.orders.value, 12);
  assert.equal(s.kpis.margin.value, 73.3);
  assert.equal(s.kpis.revenue.change, 275);
  assert.equal(s.series.length, 7);
  assert.equal(s.series.at(-1)!.revenue, 100);
  const g = s.streams.find((x) => x.id === game.id)!;
  assert.equal(g.totals.revenue, 50);
  assert.equal(g.rawSales, 5000);
  assert.equal(g.change, null, "no previous data reads as new");
});

test("long ranges bucket by week and month", () => {
  const v = { ...emptyVentures(), ...sampleData(now) };
  const m = summarise(v, "12m", now);
  assert.ok(m.series.length >= 12 && m.series.length <= 13);
  assert.match(m.series[0].label, /^\d{4}-\d{2}$/);
  const w = summarise(v, "90d", now);
  assert.ok(w.series.length >= 13 && w.series.length <= 14);
  assert.ok(m.kpis.revenue.value > 0 && m.hasSample);
});
