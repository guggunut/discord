import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-vercel-"));
let body: any = null;
const fake = createServer((req, res) => {
  let raw = "";
  req.on("data", (d) => (raw += d));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.headers.authorization !== "Bearer tok_ABCDEFGHIJKLMNOPQRSTUVWX") return (res.statusCode = 403), res.end("{}");
    if (req.url === "/v2/user") return res.end(JSON.stringify({ user: { username: "gugger" } }));
    if (req.url?.startsWith("/v13/deployments")) {
      body = JSON.parse(raw);
      return res.end(JSON.stringify({ url: "gug-pomodoro-abc123.vercel.app", alias: ["gug-pomodoro.vercel.app"], readyState: "QUEUED" }));
    }
    res.statusCode = 404;
    res.end("{}");
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
process.env.GUG_VERCEL_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
after(() => fake.close());
const { deployProject, vercelUser } = await import("../src/server/vercel.ts");

test("tokens are checked and projects deploy as static files", async () => {
  await assert.rejects(vercelUser("short"), /doesn't look like/);
  await assert.rejects(vercelUser("tok_WRONGWRONGWRONGWRONGWRONG"), /rejected/);
  assert.equal(await vercelUser("tok_ABCDEFGHIJKLMNOPQRSTUVWX"), "gugger");

  const dir = mkdtempSync(path.join(tmpdir(), "gug-site-"));
  await assert.rejects(deployProject("tok_ABCDEFGHIJKLMNOPQRSTUVWX", "pomodoro", dir), /index.html/);
  writeFileSync(path.join(dir, "index.html"), "<h1>Hi</h1>");
  mkdirSync(path.join(dir, "img"));
  writeFileSync(path.join(dir, "img/dot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const r = await deployProject("tok_ABCDEFGHIJKLMNOPQRSTUVWX", "Pomodoro", dir);
  assert.equal(r.url, "https://gug-pomodoro.vercel.app");
  assert.equal(body.name, "gug-pomodoro");
  assert.deepEqual(body.files.find((f: any) => f.file === "index.html"), { file: "index.html", data: "<h1>Hi</h1>" });
  assert.deepEqual(body.files.find((f: any) => f.file === "img/dot.png"), { file: "img/dot.png", data: "iVBORw==", encoding: "base64" });
  assert.equal(body.projectSettings.framework, null);
});
