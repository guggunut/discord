import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-hist-"));
const { changes, diffLines, hunks, takeSnapshot, undo } = await import("../src/server/history.ts");

test("line diff keeps order and marks adds and removes", () => {
  const d = diffLines(["a", "b", "c", "d"], ["a", "x", "c", "d", "e"])!;
  assert.deepEqual(d, [[" ", "a"], ["-", "b"], ["+", "x"], [" ", "c"], [" ", "d"], ["+", "e"]]);
  const h = hunks(diffLines(Array.from({ length: 30 }, (_, i) => `l${i}`), Array.from({ length: 30 }, (_, i) => (i === 15 ? "changed" : `l${i}`)))!);
  assert.equal(h.length, 1);
  assert.equal(h[0].lines.length, 8); // 3 context + remove + add + 3 context
});

test("changes since the last build, then undo restores everything", () => {
  const dir = path.join(process.env.GUG_DATA!, "proj");
  mkdirSync(path.join(dir, "src"), { recursive: true });
  writeFileSync(path.join(dir, "index.html"), "<h1>Hi</h1>\n<p>one</p>\n");
  writeFileSync(path.join(dir, "src/old.js"), "console.log(1)\n");
  assert.equal(takeSnapshot("proj", dir, "make it red"), true);

  // "Forge" edits a file, adds one, deletes one.
  writeFileSync(path.join(dir, "index.html"), "<h1>Hi</h1>\n<p>two</p>\n");
  writeFileSync(path.join(dir, "style.css"), "h1{color:red}\n");
  rmSync(path.join(dir, "src/old.js"));

  const c = changes("proj", dir);
  assert.equal(c.snapshot?.prompt, "make it red");
  assert.deepEqual(c.files.map((f) => [f.path, f.status, f.added, f.removed]), [["index.html", "modified", 1, 1], ["src/old.js", "deleted", 0, 1], ["style.css", "added", 1, 0]]);

  assert.equal(undo("proj", dir), 3);
  assert.equal(readFileSync(path.join(dir, "index.html"), "utf8"), "<h1>Hi</h1>\n<p>one</p>\n");
  assert.equal(readFileSync(path.join(dir, "src/old.js"), "utf8"), "console.log(1)\n");
  assert.equal(existsSync(path.join(dir, "style.css")), false);
  assert.deepEqual(changes("proj", dir).files, []);
  assert.throws(() => undo("proj", dir), /Nothing to undo/);
});

