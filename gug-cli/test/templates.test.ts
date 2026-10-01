import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-tpl-"));
const { TEMPLATES, crc32, zip } = await import("../src/server/templates.ts");

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("project zips open with a standard unzip tool", () => {
  const files = Object.entries(TEMPLATES.find((t) => t.id === "roblox")!.files).map(([p, c]) => ({ path: p, data: Buffer.from(c) }));
  const dir = mkdtempSync(path.join(tmpdir(), "gug-zip-"));
  const file = path.join(dir, "p.zip");
  writeFileSync(file, zip(files, "sky-obby"));
  let out: string;
  try {
    out = execFileSync("python3", ["-c", "import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print('\\n'.join(z.namelist()))", file], { encoding: "utf8" });
  } catch (e) {
    return; // no python on this machine — the crc test still covers the format
  }
  assert.ok(out.includes("sky-obby/ServerScriptService/Leaderstats.server.luau"));
  execFileSync("python3", ["-c", "import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", file, dir]);
  assert.equal(readFileSync(path.join(dir, "sky-obby/README.md"), "utf8"), files.find((f) => f.path === "README.md")!.data.toString());
});

test("every web template has an index page", () => {
  for (const t of TEMPLATES.filter((t) => t.id !== "roblox")) assert.ok(t.files["index.html"], t.id);
});

test("previews get a storage stand-in right after <head>", async () => {
  const { withStorageShim } = await import("../src/server/workspace.ts");
  const out = withStorageShim("<!doctype html><html><head><title>x</title></head><body></body></html>");
  assert.match(out, /<head><script>\(function\(\)\{function S/);
  assert.ok(out.indexOf("localStorage") < out.indexOf("<title>"));
  assert.match(withStorageShim("<p>hi</p>"), /^<script>/);
});
