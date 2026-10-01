// GUG-cli v1 runs on your own computer, so there are no accounts. What protects it instead:
//
// 1. It listens on 127.0.0.1 only (not reachable from the network).
// 2. Host-header check: blocks DNS-rebinding pages from talking to it through your browser.
// 3. A private access token (printed by `gug serve` as a link) is required — other
//    programs or local users can't use it just because they can reach the port.
// 4. Every state-changing request needs a custom header, so other websites can't
//    trigger actions with cross-site form posts.
// 5. API keys are encrypted at rest (AES-256-GCM) with a key file only you can read.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { NextFunction, Request, Response } from "express";
import { config, paths } from "./config.js";
import { open, randomToken, safeEqual, seal } from "./crypto.js";
import type { Store } from "./store.js";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const COOKIE = "gug_local";

function readOrCreate(file: string, make: () => string): string {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const v = make();
  writeFileSync(file, v + "\n", { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on this filesystem */
  }
  return v;
}

let vaultKey: Buffer | null = null;
export function getVaultKey(): Buffer {
  vaultKey ??= Buffer.from(readOrCreate(paths.key(), () => randomBytes(32).toString("base64")), "base64");
  return vaultKey;
}

export function getAccessToken(): string {
  return readOrCreate(paths.token(), () => randomToken(24));
}

export function rotateAccessToken(): string {
  const t = randomToken(24);
  writeFileSync(paths.token(), t + "\n", { mode: 0o600 });
  return t;
}

export function accessUrl(host = config.host, port = config.port): string {
  const h = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  // The token rides in the fragment, so it never appears in server logs or Referer headers.
  return `http://${h}:${port}/#token=${getAccessToken()}`;
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.toLowerCase().replace(/:\d+$/, "");
  return LOOPBACK.has(host) || config.extraHosts.includes(host);
}

export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function hostGuard(req: Request, _res: Response, next: NextFunction) {
  if (!hostAllowed(req.headers.host)) return next(new HttpError(403, "Unexpected host. GUG-cli only answers on localhost."));
  next();
}

export function csrfGuard(req: Request, _res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  if (req.get("x-gug-request") !== "1") return next(new HttpError(403, "Missing request header."));
  next();
}

export function isUnlocked(req: Request): boolean {
  const c = readCookie(req, COOKIE);
  return !!c && safeEqual(c, getAccessToken());
}

export function requireUnlocked(req: Request, _res: Response, next: NextFunction) {
  if (!isUnlocked(req)) return next(new HttpError(401, "Locked. Open GUG-cli with the link `gug serve` printed (or run `gug link`)."));
  next();
}

export function unlock(req: Request, res: Response, token: string): void {
  if (!token || !safeEqual(token, getAccessToken())) throw new HttpError(401, "That access link isn’t valid any more. Run `gug link` for a fresh one.");
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", path: "/", maxAge: 30 * 86_400_000 });
}

// ---------- vault ----------
const NAME_RE = /^[a-z0-9_.:-]{2,40}$/i;

export function vaultSet(store: Store, name: string, value: string): void {
  if (!NAME_RE.test(name)) throw new HttpError(400, "Bad key name.");
  if (!value) throw new HttpError(400, "Paste a value first.");
  if (value.length > 8000) throw new HttpError(400, "That value is too long.");
  store.data.secrets[name] = seal(getVaultKey(), value, `secret:${name}`);
  store.save();
}

export function vaultGet(store: Store, name: string): string | undefined {
  const s = store.data.secrets[name];
  return s ? open(getVaultKey(), s, `secret:${name}`).toString() : undefined;
}

export function vaultDelete(store: Store, name: string): void {
  delete store.data.secrets[name];
  store.save();
}

export function vaultList(store: Store) {
  return Object.keys(store.data.secrets)
    .sort()
    .map((name) => {
      const v = vaultGet(store, name) ?? "";
      return { name, preview: v.length > 12 ? `${v.slice(0, 7)}…${v.slice(-4)}` : "••••" };
    });
}

export function claudeKeys(store: Store): string[] {
  return ["anthropic", "anthropic_2", "anthropic_3"].map((n) => vaultGet(store, n)).filter((v): v is string => !!v);
}
