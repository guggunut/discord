import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-int-"));
const { Store } = await import("../src/server/store.ts");
const { createApp } = await import("../src/server/http.ts");
const { createToken } = await import("../src/server/integrations.ts");
const { paths } = await import("../src/server/config.ts");

const store = new Store(paths.db());
let base = "";
let server: import("node:http").Server;
before(async () => {
  server = createApp(store).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (p: string, body: object, auth?: string) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });

test("local API tokens are stored hashed and only open the ask endpoints", async () => {
  const { token, info } = createToken(store, "Discord bot");
  assert.match(token, /^gug_/);
  assert.ok(!JSON.stringify(store.data).includes(token), "the token itself is never stored");
  assert.equal(info.name, "Discord bot");

  assert.equal((await post("/api/v1/ask", { text: "hi" })).status, 401);
  assert.equal((await post("/api/v1/ask", { text: "hi" }, "gug_" + "x".repeat(32))).status, 401);
  const empty = await post("/api/v1/ask", { text: " " }, token);
  assert.equal(empty.status, 400);
  const noKey = await post("/api/v1/ask", { text: "hello" }, token);
  assert.equal(noKey.status, 502);
  assert.match((await noKey.json()).error, /No Claude API key/);
  const agents = await fetch(`${base}/api/v1/agents`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await agents.json()).length, 12);

  // A token is not a session: everything else stays locked.
  const state = await fetch(`${base}/api/state`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(state.status, 401);
  assert.ok(store.data.tokens[0].uses >= 3);
});

test("tokens are rate limited", async () => {
  const { token } = createToken(store, "Busy script");
  let last = 0;
  for (let i = 0; i < 31; i++) last = (await post("/api/v1/ask", { text: "" }, token)).status;
  assert.equal(last, 429);
});
