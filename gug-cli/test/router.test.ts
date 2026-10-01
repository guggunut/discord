import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.GUG_DATA ??= mkdtempSync(path.join(tmpdir(), "gug-test-"));

const { pickEngine } = await import("../src/server/router.ts");
const { parseFileBlocks, safeJoin } = await import("../src/server/workspace.ts");
const { isLoopbackUrl } = await import("../src/server/engines/local.ts");

test("auto routing picks Claude Code for repo work, local for private jobs", () => {
  const base = { preferred: "auto" as const, hasProject: true, codeReady: true, localReady: false };
  assert.equal(pickEngine("fix the failing test in router.ts", base), "code");
  assert.equal(pickEngine("write a tweet about my lamp", base), "claude");
  assert.equal(pickEngine("fix the failing test", { ...base, codeReady: false }), "claude");
  assert.equal(pickEngine("keep this private and offline", { ...base, localReady: true }), "local");
  assert.equal(pickEngine("anything", { ...base, preferred: "claude" }), "claude");
});

test("file blocks are parsed from a model reply", () => {
  const files = parseFileBlocks('Here you go\n<file path="index.html">\n<h1>Hi</h1>\n</file>\n<file path="js/app.js">\nconsole.log(1)\n</file>\nDone.');
  assert.deepEqual(files.map((f) => f.path), ["index.html", "js/app.js"]);
  assert.equal(files[0].content, "<h1>Hi</h1>\n");
});

test("paths can't escape a project folder", () => {
  const root = "/tmp/gug/project";
  assert.equal(safeJoin(root, "src/a.ts"), "/tmp/gug/project/src/a.ts");
  for (const bad of ["../x", "a/../../x", "/etc/passwd", "", "a\0b"]) assert.throws(() => safeJoin(root, bad), bad);
});

test("local model URLs must be loopback", () => {
  assert.ok(isLoopbackUrl("http://127.0.0.1:11434"));
  assert.ok(isLoopbackUrl("http://localhost:1234"));
  assert.ok(!isLoopbackUrl("http://169.254.169.254/latest"));
  assert.ok(!isLoopbackUrl("http://10.0.0.5:11434"));
  assert.ok(!isLoopbackUrl("file:///etc/passwd"));
});

// ---- fallback chain against a fake Messages API ----
let server: Server;
const seen: string[] = [];
before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      seen.push(j.model);
      if (j.model === "claude-opus-5-5") {
        res.writeHead(429, { "content-type": "application/json", "retry-after": "0" });
        return res.end(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }));
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (event: string, data: object) => res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
      send("message_start", { message: { id: "msg_1", type: "message", role: "assistant", model: j.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 5, output_tokens: 0 } } });
      send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
      send("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hello from " + j.model } });
      send("content_block_stop", { index: 0 });
      send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } });
      send("message_stop", {});
      res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});
after(() => server.close());

test("a rate-limited model falls back to the next one in the chain", async () => {
  const { runClaude } = await import("../src/server/engines/claude.ts");
  const events = [];
  for await (const ev of runClaude({ keys: ["sk-ant-test-key"], system: "test", messages: [{ role: "user", content: "hi" }], mode: "deep" })) events.push(ev);
  const text = events.filter((e) => e.type === "text").map((e: any) => e.text).join("");
  assert.equal(text, "Hello from claude-sonnet-5-5");
  assert.ok(events.some((e) => e.type === "fallback" && e.from === "claude-opus-5-5" && e.reason === "rate limited"));
  assert.equal(events.at(-1)?.type, "done");
  assert.ok(seen.includes("claude-opus-5-5") && seen.includes("claude-sonnet-5-5"));
});

test("no key gives a helpful error instead of a crash", async () => {
  const { runClaude } = await import("../src/server/engines/claude.ts");
  const events = [];
  for await (const ev of runClaude({ keys: [], system: "x", messages: [{ role: "user", content: "hi" }], mode: "fast" })) events.push(ev);
  assert.equal(events[0].type, "error");
});
