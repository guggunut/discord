// Profile pictures for agents (and you). Images are re-encoded in the browser
// to a small square, checked here by their magic bytes, and stored as files.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agentById } from "./agents.js";
import { config } from "./config.js";
import { HttpError } from "./local.js";
import type { Store } from "./store.js";

const dir = () => path.join(config.dataDir, "avatars");
const TYPES = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;
type Ext = keyof typeof TYPES;

const checkId = (id: string) => {
  if (id !== "you" && !agentById(id)) throw new HttpError(404, "Unknown agent.");
  return id;
};

function sniff(b: Buffer): Ext | null {
  if (b.length > 8 && b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function saveAvatar(store: Store, idIn: string, dataUrl: unknown): number {
  const id = checkId(idIn);
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ""));
  if (!m) throw new HttpError(400, "Send a PNG, JPEG or WebP image.");
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 600_000) throw new HttpError(400, "That picture is too big — keep it under 600 KB.");
  const ext = sniff(buf);
  if (!ext) throw new HttpError(400, "That file isn't a real image.");
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  for (const e of Object.keys(TYPES)) rmSync(path.join(dir(), `${id}.${e}`), { force: true });
  writeFileSync(path.join(dir(), `${id}.${ext}`), buf, { mode: 0o600 });
  const v = Date.now();
  store.data.avatars = { ...store.data.avatars, [id]: { ext, v } };
  store.save();
  return v;
}

export function removeAvatar(store: Store, idIn: string) {
  const id = checkId(idIn);
  for (const e of Object.keys(TYPES)) rmSync(path.join(dir(), `${id}.${e}`), { force: true });
  const { [id]: _, ...rest } = store.data.avatars;
  store.data.avatars = rest;
  store.save();
}

export function readAvatar(store: Store, idIn: string): { type: string; body: Buffer } {
  const id = checkId(idIn);
  const a = store.data.avatars[id];
  const file = a && path.join(dir(), `${id}.${a.ext}`);
  if (!a || !existsSync(file!)) throw new HttpError(404, "No picture.");
  return { type: TYPES[a.ext as Ext], body: readFileSync(file!) };
}

export const avatarVersions = (store: Store) => Object.fromEntries(Object.entries(store.data.avatars).map(([k, a]) => [k, a.v]));
