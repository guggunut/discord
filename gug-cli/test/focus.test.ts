import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "gug-focus-"));
process.env.GUG_DATA = dir;
const { Store } = await import("../src/server/store.ts");
const { focusStats } = await import("../src/server/focus.ts");

test("focus stats add up today, the week and the streak", () => {
  const store = new Store(path.join(dir, "db.json"));
  const sep = (d: number, h = 10) => new Date(2026, 8, d, h).toISOString();
  store.data.focus = [
    { at: sep(23), minutes: 90, label: "" }, // outside the last 7 days
    { at: sep(28), minutes: 25, label: "" },
    { at: sep(29), minutes: 50, label: "maths" },
    { at: sep(30), minutes: 25, label: "" },
    { at: sep(30, 16), minutes: 25, label: "" },
  ];
  const now = new Date(2026, 9, 1, 9);
  const s = focusStats(store, now);
  assert.equal(s.today, 0);
  assert.equal(s.streak, 3, "28th, 29th, 30th Sept — today not started yet");
  assert.equal(s.week, 125);
  store.data.focus.push({ at: new Date(2026, 9, 1, 8).toISOString(), minutes: 25, label: "" });
  assert.equal(focusStats(store, now).streak, 4);
  assert.equal(focusStats(store, now).today, 25);
});
