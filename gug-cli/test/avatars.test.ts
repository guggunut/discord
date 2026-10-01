import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-avatar-"));
const { Store } = await import("../src/server/store.ts");
const { avatarVersions, readAvatar, removeAvatar, saveAvatar } = await import("../src/server/avatars.ts");

const png = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64");

test("profile pictures must be real images for real agents", () => {
  const store = new Store(path.join(process.env.GUG_DATA!, "db.json"));
  assert.throws(() => saveAvatar(store, "nobody", png), /Unknown agent/);
  assert.throws(() => saveAvatar(store, "atlas", "data:image/svg+xml;base64,PHN2Zz4="), /PNG, JPEG or WebP/);
  assert.throws(() => saveAvatar(store, "atlas", "data:image/png;base64," + Buffer.from("<script>").toString("base64")), /real image/);
  const v = saveAvatar(store, "atlas", png);
  assert.equal(avatarVersions(store).atlas, v);
  assert.equal(readAvatar(store, "atlas").type, "image/png");
  saveAvatar(store, "you", png);
  removeAvatar(store, "atlas");
  assert.throws(() => readAvatar(store, "atlas"), /No picture/);
  assert.deepEqual(Object.keys(avatarVersions(store)), ["you"]);
});
