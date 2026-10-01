import assert from "node:assert/strict";
import { mkdtempSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-sec-"));
const { open, seal } = await import("../src/server/crypto.ts");
const local = await import("../src/server/local.ts");
const { Store } = await import("../src/server/store.ts");
const { createApp } = await import("../src/server/http.ts");
const { paths } = await import("../src/server/config.ts");

test("sealed data needs the right key and the right slot", () => {
  const key = Buffer.alloc(32, 7);
  const s = seal(key, "sk-ant-secret", "secret:anthropic");
  assert.equal(open(key, s, "secret:anthropic").toString(), "sk-ant-secret");
  assert.throws(() => open(Buffer.alloc(32, 8), s, "secret:anthropic"));
  assert.throws(() => open(key, s, "secret:github"));
});

test("vault stores keys encrypted, never in plaintext", () => {
  const store = new Store(paths.db());
  local.vaultSet(store, "anthropic", "sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
  assert.equal(local.vaultGet(store, "anthropic"), "sk-ant-api03-abcdefghijklmnopqrstuvwxyz");
  store.flush();
  assert.ok(!JSON.stringify(store.data).includes("abcdefghijklmnop"));
  assert.deepEqual(local.claudeKeys(store), ["sk-ant-api03-abcdefghijklmnopqrstuvwxyz"]);
  assert.equal(local.vaultList(store)[0].preview, "sk-ant-…wxyz");
  if (process.platform !== "win32") {
    assert.equal(statSync(paths.key()).mode & 0o777, 0o600, "key file readable only by you");
    assert.equal(statSync(paths.db()).mode & 0o777, 0o600);
  }
  assert.throws(() => local.vaultSet(store, "../evil", "x"), /Bad key name/);
});

test("host check blocks DNS-rebinding hosts", () => {
  assert.ok(local.hostAllowed("127.0.0.1:4747"));
  assert.ok(local.hostAllowed("localhost:5173"));
  assert.ok(local.hostAllowed("[::1]:4747"));
  assert.ok(!local.hostAllowed("evil.example.com"));
  assert.ok(!local.hostAllowed("127.0.0.1.evil.com:4747"));
  assert.ok(!local.hostAllowed(undefined));
});

// ---- end to end over HTTP ----
let base = "";
let server: import("node:http").Server;
before(async () => {
  const app = createApp(new Store(paths.db()));
  server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const H = { "content-type": "application/json", "x-gug-request": "1" };

test("API is locked until unlocked with the access token", async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/unlock`, { method: "POST", headers: H, body: JSON.stringify({ token: "wrong" }) })).status, 401);
  const ok = await fetch(`${base}/api/unlock`, { method: "POST", headers: H, body: JSON.stringify({ token: local.getAccessToken() }) });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie")!.split(";")[0];
  assert.match(ok.headers.get("set-cookie")!, /HttpOnly/i);
  assert.match(ok.headers.get("set-cookie")!, /SameSite=Strict/i);
  const state = await fetch(`${base}/api/state`, { headers: { cookie } });
  assert.equal(state.status, 200);
  assert.ok(Array.isArray((await state.json()).vault));

  // Cross-site style POST without the custom header is refused.
  const csrf = await fetch(`${base}/api/profile`, { method: "PATCH", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
  assert.equal(csrf.status, 403);
  // A foreign Host header is refused even with the cookie.
  const { request } = await import("node:http");
  const status = await new Promise<number>((resolve, reject) => {
    const r = request(`${base}/api/state`, { headers: { cookie, host: "attacker.example" } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on("error", reject);
    r.end();
  });
  assert.equal(status, 403);
  // Project paths can't escape the workspace.
  const esc = await fetch(`${base}/api/projects/playground/file?path=${encodeURIComponent("../../vault.key")}`, { headers: { cookie } });
  assert.equal(esc.status, 400);
});
