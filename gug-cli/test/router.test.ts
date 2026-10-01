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
const toolRequests: string[][] = [];
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
      const last = j.messages.at(-1);
      if (j.tools?.length && typeof last.content === "string") {
        // First turn with tools: call each requested tool named in the prompt.
        const names: string[] = last.content.split(" ").filter((w: string) => j.tools.some((t: any) => t.name === w));
        toolRequests.push(j.tools.map((t: any) => t.name));
        names.forEach((name, i) => {
          send("content_block_start", { index: i, content_block: { type: "tool_use", id: `toolu_${i}`, name, input: {} } });
          send("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: name === "log_money" ? '{"stream":"shop","type":"sale","amount":25}' : "{}" } });
          send("content_block_stop", { index: i });
        });
        send("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 4 } });
        send("message_stop", {});
        return res.end();
      }
      if (Array.isArray(last.content) && last.content[0]?.type === "tool_result") {
        const text = "Results: " + last.content.map((r: any) => `${r.is_error ? "ERR " : ""}${r.content}`).join(" | ");
        send("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
        send("content_block_delta", { index: 0, delta: { type: "text_delta", text } });
        send("content_block_stop", { index: 0 });
        send("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4 } });
        send("message_stop", {});
        return res.end();
      }
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

test("agents can use tools on your data, and tool errors don't crash the chat", async () => {
  const { runClaude } = await import("../src/server/engines/claude.ts");
  const { toolsFor } = await import("../src/server/tools.ts");
  const { Store } = await import("../src/server/store.ts");
  const { validateStream } = await import("../src/server/ventures.ts");
  const store = new Store(path.join(process.env.GUG_DATA!, "tools-db.json"));
  store.data.ventures.streams.push(validateStream({ name: "Shop", kind: "shopify" }));
  const tools = toolsFor(store, "ledger");
  assert.deepEqual(tools.map((t) => t.def.name), ["money_summary", "log_money", "leave_note", "remember"]);
  assert.ok(tools.every((t) => t.def.eager_input_streaming), "client tools stream their input");

  const events: any[] = [];
  for await (const ev of runClaude({ keys: ["sk-ant-test-key"], system: "test", messages: [{ role: "user", content: "please log_money then money_summary and unknown_tool" }], mode: "fast", tools })) events.push(ev);
  const toolEvents = events.filter((e) => e.type === "tool");
  assert.equal(toolEvents.length, 2);
  assert.match(toolEvents[0].detail, /sale 25 → Shop/);
  assert.equal(store.data.ventures.entries.length, 1, "the sale was really logged");
  const text = events.filter((e) => e.type === "text").map((e) => e.text).join("");
  assert.match(text, /Logged sale of 25 to Shop/);
  assert.match(text, /"revenue":25/);
  assert.equal(events.at(-1)?.type, "done");
  assert.deepEqual(toolRequests.at(-1), ["money_summary", "log_money", "leave_note", "remember"]);

  // A tool that fails reports the error back to the model instead of throwing.
  store.data.ventures.streams = [];
  const again: any[] = [];
  for await (const ev of runClaude({ keys: ["sk-ant-test-key"], system: "test", messages: [{ role: "user", content: "log_money" }], mode: "fast", tools })) again.push(ev);
  assert.match(again.find((e) => e.type === "tool").detail, /couldn’t: No stream called/);
  assert.match(again.filter((e) => e.type === "text").map((e) => e.text).join(""), /ERR No stream/);
});

test("an agent's data access setting limits its tools", async () => {
  const { toolsFor } = await import("../src/server/tools.ts");
  const { Store } = await import("../src/server/store.ts");
  const store = new Store(path.join(process.env.GUG_DATA!, "access-db.json"));
  assert.ok(toolsFor(store, "echo").some((t) => t.writes), "can make changes by default");
  store.data.prefs.agents.echo = { autonomy: "read" };
  assert.deepEqual(toolsFor(store, "echo").map((t) => t.def.name), ["list_posts"]);
  store.data.prefs.agents.echo = { autonomy: "off" };
  assert.equal(toolsFor(store, "echo").length, 0);
});

test("shared memory reaches every agent's instructions", async () => {
  const { Store } = await import("../src/server/store.ts");
  const { addFact, memoryText } = await import("../src/server/memory.ts");
  const { setMemoryProvider, systemFor, agentById } = await import("../src/server/agents.ts");
  const store = new Store(path.join(process.env.GUG_DATA!, "memory-db.json"));
  assert.equal(memoryText(store), "", "nothing to add when memory is empty");
  store.data.memory.about = "Kacper, sells desk lamps, revising for exams.";
  addFact(store, "Prefers   UK spelling", "you");
  addFact(store, "prefers uk spelling", "ledger");
  assert.equal(store.data.memory.facts.length, 1, "duplicates are ignored");
  setMemoryProvider(() => memoryText(store));
  const sys = systemFor(agentById("sage")!);
  assert.match(sys, /About them: Kacper, sells desk lamps/);
  assert.match(sys, /- Prefers UK spelling/);
  setMemoryProvider(() => "");
});
