import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-growth-"));
const { emptyGrowth, extractJsonArray, growthStats, validatePost } = await import("../src/server/growth.ts");

test("posts are validated and stamped when posted", () => {
  assert.throws(() => validatePost({ date: "tomorrow", title: "x" }), /date/);
  assert.throws(() => validatePost({ date: "2026-10-01", time: "7pm", title: "x" }), /time/);
  assert.throws(() => validatePost({ date: "2026-10-01", title: " " }), /title/);
  const p = validatePost({ date: "2026-10-01", title: "Lamp reel", platform: "myspace" });
  assert.equal(p.platform, "instagram");
  assert.equal(p.status, "idea");
  const posted = validatePost({ status: "posted", metrics: { views: "1200", likes: 80.6, comments: -3 } }, p);
  assert.ok(posted.postedAt);
  assert.deepEqual(posted.metrics, { views: 1200, likes: 81, comments: 0, shares: 0 });
  assert.equal(posted.id, p.id);
});

test("Echo's plan is pulled out of prose and code fences", () => {
  assert.deepEqual(extractJsonArray('Here you go!\n```json\n[{"title":"a"},{"title":"b"}]\n```'), [{ title: "a" }, { title: "b" }]);
  assert.throws(() => extractJsonArray("no plan today"), /didn't return a plan/);
  assert.throws(() => extractJsonArray("[{oops}]"), /garbled/);
});

test("stats count only posted posts and compare with the week before", () => {
  const g = emptyGrowth();
  const add = (date: string, views: number, likes: number, status = "posted", platform = "tiktok") => g.posts.push(validatePost({ date, title: "t", status, platform, metrics: { views, likes, comments: 0, shares: 0 } }));
  add("2026-10-01", 1000, 100);
  add("2026-10-03", 3000, 50, "posted", "instagram");
  add("2026-10-04", 9999, 999, "draft");
  add("2026-09-25", 2000, 75);
  const s = growthStats(g, "2026-09-28", "2026-10-04");
  assert.equal(s.now.posts, 2);
  assert.equal(s.now.views, 4000);
  assert.equal(s.change.views, 100);
  assert.equal(s.change.engagement, 100);
  assert.equal(s.rate, 3.8);
  assert.equal(s.byPlatform.find((p) => p.platform === "instagram")!.views, 3000);
});
