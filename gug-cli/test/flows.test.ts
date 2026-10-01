import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-flows-"));
const { isDue, validateFlow } = await import("../src/server/flows.ts");

const base = { name: "Test", steps: [{ agent: "atlas", prompt: "hi" }] };

test("validation catches bad flows", () => {
  assert.throws(() => validateFlow({ ...base, name: "" }), /name/);
  assert.throws(() => validateFlow({ ...base, steps: [] }), /at least one step/);
  assert.throws(() => validateFlow({ ...base, steps: [{ agent: "nobody", prompt: "x" }] }), /Unknown agent/);
  assert.throws(() => validateFlow({ ...base, trigger: { type: "every", minutes: 1 } }), /15 minutes/);
  assert.throws(() => validateFlow({ ...base, trigger: { type: "daily", at: "25:00" } }), /08:00/);
  const f = validateFlow({ ...base, trigger: { type: "daily", at: "08:30" } });
  assert.deepEqual(f.trigger, { type: "daily", at: "08:30" });
  assert.equal(f.enabled, true);
});

test("daily flows fire once per day after their time", () => {
  const f = validateFlow({ ...base, trigger: { type: "daily", at: "08:00" } });
  const at = (h: number, m: number, d = 1) => new Date(2026, 9, d, h, m);
  assert.ok(!isDue(f, at(7, 59)));
  assert.ok(isDue(f, at(8, 0)));
  f.lastRunAt = at(8, 0).toISOString();
  assert.ok(!isDue(f, at(8, 30)));
  assert.ok(isDue(f, at(8, 1, 2)), "due again the next day");
  f.enabled = false;
  assert.ok(!isDue(f, at(9, 0, 3)));
});

test("repeating flows wait the full interval", () => {
  const f = validateFlow({ ...base, trigger: { type: "every", minutes: 60 } });
  const created = new Date(f.createdAt).getTime();
  assert.ok(!isDue(f, new Date(created + 59 * 60_000)));
  assert.ok(isDue(f, new Date(created + 60 * 60_000)));
});

test("manual flows never fire on their own", () => {
  const f = validateFlow(base);
  assert.ok(!isDue(f, new Date(Date.now() + 1e9)));
});
