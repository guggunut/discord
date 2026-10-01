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
const { blenderSnapshot, testServer, validateServer, writeClaudeConfig } = await import("../src/server/mcp.ts");

// A minimal stdio MCP server.
const fakeMcp = path.join(dir, "fake-mcp.mjs");
writeFileSync(fakeMcp, `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
rl.on("line", (l) => {
  const m = JSON.parse(l);
  if (m.method === "initialize") send({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "1" } } });
  if (m.method === "tools/list") send({ jsonrpc: "2.0", id: m.id, result: { tools: [{ name: "get_scene_info" }, { name: "execute_blender_code" }] } });
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
