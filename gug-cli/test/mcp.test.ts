import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const dir = mkdtempSync(path.join(tmpdir(), "gug-mcp-"));
process.env.GUG_DATA = dir;
const { Store } = await import("../src/server/store.ts");
const { blenderSnapshot, callTool, listTools, rememberTools, testServer, validateServer, writeClaudeConfig } = await import("../src/server/mcp.ts");
const { toolsFor } = await import("../src/server/tools.ts");

// A minimal stdio MCP server.
const fakeMcp = path.join(dir, "fake-mcp.mjs");
writeFileSync(fakeMcp, `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "get_scene_info", description: "Scene summary", inputSchema: { type: "object", properties: {} } }, { name: "execute_blender_code" }] } });
  if (m.method === "tools/call" && m.params.name === "get_scene_info") send({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: "Scene: Lamp" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }, { type: "resource", resource: {} }] } });
  if (m.method === "tools/call" && m.params.name === "execute_blender_code") send({ jsonrpc: "2.0", id: m.id, result: { isError: true, content: [{ type: "text", text: "code was " + m.params.arguments.code }] } });
  if (m.method === "tools/call" && m.params.name === "nope") send({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Unknown tool: nope" } });
});`);

test("servers are validated, secrets go to the vault, and Claude Code gets a config", () => {
  const store = new Store(path.join(dir, "db.json"));
  assert.throws(() => validateServer(store, { name: "Bad Name!", command: "x" }), /lowercase/);
  assert.throws(() => validateServer(store, { name: "blender", command: "" }), /command/);
  const s = validateServer(store, { name: "blender", app: "blender", command: process.execPath, args: [fakeMcp], env: { BLENDER_TOKEN: "s3cret-value" } });
  store.data.mcp.push(s);
  assert.deepEqual(s.envKeys, ["BLENDER_TOKEN"]);
  assert.ok(!JSON.stringify(store.data.mcp).includes("s3cret-value"), "env values are sealed");
  store.data.mcp.push(validateServer(store, { name: "off-one", command: "x", enabled: false }));
  const cfg = writeClaudeConfig(store);
  assert.deepEqual(cfg.servers, ["blender"]);
  const json = JSON.parse(readFileSync(cfg.configPath, "utf8"));
  assert.equal(json.mcpServers.blender.env.BLENDER_TOKEN, "s3cret-value");
  assert.equal(json.mcpServers["off-one"], undefined);
  if (process.platform !== "win32") assert.equal(statSync(cfg.configPath).mode & 0o777, 0o600);
});

test("testing a server does a real MCP handshake and lists its tools", async () => {
  const store = new Store(path.join(dir, "db2.json"));
  const s = validateServer(store, { name: "fake", command: process.execPath, args: [fakeMcp] });
  assert.deepEqual(await testServer(store, s, 10_000), ["get_scene_info", "execute_blender_code"]);
  const broken = validateServer(store, { name: "broken", command: process.execPath, args: ["-e", "process.exit(3)"] });
  await assert.rejects(testServer(store, broken, 10_000), /exited \(code 3\)/);
});

test("tools can be listed with schemas and run by hand", async () => {
  const store = new Store(path.join(dir, "db3.json"));
  const s = validateServer(store, { name: "fake", command: process.execPath, args: [fakeMcp] });
  const tools = await listTools(store, s, 10_000);
  assert.deepEqual(tools[0], { name: "get_scene_info", description: "Scene summary", inputSchema: { type: "object", properties: {} } });
  const r = await callTool(store, s, "get_scene_info", {}, 10_000);
  assert.deepEqual(r, { isError: false, content: [{ type: "text", text: "Scene: Lamp" }, { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }, { type: "other", text: "[resource content]" }] });
  const bad = await callTool(store, s, "execute_blender_code", { code: "1/0" }, 10_000);
  assert.equal(bad.isError, true);
  assert.equal(bad.content[0].type === "text" && bad.content[0].text, "code was 1/0");
  await assert.rejects(callTool(store, s, "nope", {}, 10_000), /Unknown tool/);
});

test("Forge can use connected apps from chat; read-only agents only get the get_ tools", async () => {
  const store = new Store(path.join(dir, "db4.json"));
  const s = validateServer(store, { name: "blender", app: "blender", command: process.execPath, args: [fakeMcp] });
  rememberTools(s, await listTools(store, s, 10_000));
  store.data.mcp.push(s);
  const names = (id: string) => toolsFor(store, id).map((t) => t.def.name);
  assert.ok(names("forge").includes("blender__get_scene_info"));
  assert.ok(names("forge").includes("blender__execute_blender_code"));
  assert.ok(!names("ledger").some((n) => n.startsWith("blender__")), "only app-building agents get app tools");
  store.data.prefs.agents.forge = { ...(store.data.prefs.agents.forge ?? {}), autonomy: "read" } as never;
  assert.ok(names("forge").includes("blender__get_scene_info"));
  assert.ok(!names("forge").includes("blender__execute_blender_code"), "writes are hidden when read-only");
  const t = toolsFor(store, "forge").find((x) => x.def.name === "blender__get_scene_info")!;
  assert.equal(t.label, "Blender · get scene info");
  assert.deepEqual(await t.run({}), { text: "Scene: Lamp\n[an image came back — the user can see it in Code → Live view]\n[resource content]", summary: "Blender answered" });
  s.enabled = false;
  assert.ok(!names("forge").some((n) => n.startsWith("blender__")), "switched-off apps disappear");
});

// A stand-in for the Blender MCP add-on's socket.
const blender = createServer((sock) => {
  sock.on("data", (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === "get_viewport_screenshot") {
      writeFileSync(m.params.filepath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      sock.end(JSON.stringify({ status: "success", result: { success: true, width: 960 } }));
    } else sock.end(JSON.stringify({ status: "success", result: { name: "Scene", objects: [{ name: "Lamp", type: "MESH" }] } }));
  });
});
await new Promise<void>((r) => blender.listen(0, "127.0.0.1", r));
process.env.GUG_BLENDER_PORT = String((blender.address() as AddressInfo).port);
after(() => blender.close());

test("Blender snapshots come from the add-on socket", async () => {
  const snap = await blenderSnapshot();
  assert.equal(snap.png.toString("hex"), "89504e47");
  assert.deepEqual(snap.scene, { name: "Scene", objects: [{ name: "Lamp", type: "MESH" }] });
  process.env.GUG_BLENDER_PORT = "1";
  await assert.rejects(blenderSnapshot(), /isn't reachable/);
});
