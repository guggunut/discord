// Publish a Code project to Vercel with a personal token: files are sent
// inline (no git needed) and Vercel returns a live https URL.
import { readFileSync } from "node:fs";
import { HttpError } from "./local.js";
import { listFiles, safeJoin } from "./workspace.js";

const API = () => process.env.GUG_VERCEL_URL ?? "https://api.vercel.com";
const TEXT = /\.(html?|css|m?js|json|svg|txt|md|xml|webmanifest|map)$/i;

async function call(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${API()}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) }, signal: AbortSignal.timeout(60_000) });
  const j = (await r.json().catch(() => ({}))) as any;
  if (r.status === 401 || r.status === 403) throw new HttpError(400, "Vercel rejected the token.");
  if (!r.ok) throw new HttpError(502, `Vercel: ${j?.error?.message ?? r.status}`);
  return j;
}

export async function vercelUser(token: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new HttpError(400, "That doesn't look like a Vercel token.");
  const j = await call(token, "/v2/user");
  return String(j?.user?.username ?? j?.user?.email ?? "you");
}

/** Deploys the project folder as a static site. Returns the live URL. */
export async function deployProject(token: string, project: string, dir: string): Promise<{ url: string; state: string }> {
  const list = listFiles(dir);
  if (!list.some((f) => f.path === "index.html")) throw new HttpError(400, "Add an index.html first — Vercel serves it as the home page.");
  if (list.length > 300) throw new HttpError(400, "That's a lot of files for a quick publish (max 300).");
  let bytes = 0;
  const files = list.map((f) => {
    const buf = readFileSync(safeJoin(dir, f.path));
    bytes += buf.length;
    return TEXT.test(f.path) ? { file: f.path, data: buf.toString("utf8") } : { file: f.path, data: buf.toString("base64"), encoding: "base64" };
  });
  if (bytes > 20 * 1024 * 1024) throw new HttpError(400, "Projects over 20 MB need a git-based deploy.");
  const name = `gug-${project}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 52);
  const j = await call(token, "/v13/deployments?skipAutoDetectionConfirmation=1", {
    method: "POST",
    body: JSON.stringify({ name, files, target: "production", projectSettings: { framework: null, buildCommand: null, outputDirectory: null, installCommand: null } }),
  });
  const url = String(j?.alias?.[0] ?? j?.url ?? "");
  if (!url) throw new HttpError(502, "Vercel didn't return a URL.");
  return { url: url.startsWith("http") ? url : `https://${url}`, state: String(j?.readyState ?? "QUEUED") };
}
