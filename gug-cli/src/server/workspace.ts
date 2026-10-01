// Per-user project folders for vibe coding. All paths are validated so nothing
// can escape the user's own workspace.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { paths } from "./config.js";
import { HttpError } from "./local.js";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SKIP = new Set(["node_modules", ".git", "dist", ".next", ".cache"]);
export const MAX_FILE = 256 * 1024;

export function workspaceRoot(): string {
  const dir = paths.workspaces();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function projectDir(project: string): string {
  if (!NAME_RE.test(project)) throw new HttpError(400, "Bad project name.");
  const dir = path.join(workspaceRoot(), project);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Resolve a relative path inside a project, refusing anything that escapes it. */
export function safeJoin(root: string, rel: string): string {
  if (!rel || rel.length > 200 || rel.includes("\0") || path.isAbsolute(rel)) throw new HttpError(400, "Bad file path.");
  const full = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) throw new HttpError(400, "Path escapes the project.");
  return full;
}

export function listProjects(): string[] {
  const root = workspaceRoot();
  const names = readdirSync(root).filter((n) => NAME_RE.test(n) && statSync(path.join(root, n)).isDirectory());
  if (!names.includes("playground")) {
    seedPlayground();
    names.unshift("playground");
  }
  return names.sort((a, b) => (a === "playground" ? -1 : b === "playground" ? 1 : a.localeCompare(b)));
}

export function listFiles(dir: string, base = "", out: { path: string; size: number }[] = []): { path: string; size: number }[] {
  if (out.length > 400) return out;
  for (const name of readdirSync(path.join(dir, base)).sort()) {
    if (SKIP.has(name) || name.startsWith(".")) continue;
    const rel = base ? `${base}/${name}` : name;
    const st = statSync(path.join(dir, rel));
    if (st.isDirectory()) listFiles(dir, rel, out);
    else out.push({ path: rel, size: st.size });
  }
  return out;
}

export function readFile(dir: string, rel: string): string {
  const full = safeJoin(dir, rel);
  if (!existsSync(full)) throw new HttpError(404, "File not found.");
  if (statSync(full).size > MAX_FILE) throw new HttpError(413, "File too large to open here.");
  return readFileSync(full, "utf8");
}

export function writeFile(dir: string, rel: string, content: string): void {
  if (Buffer.byteLength(content) > MAX_FILE) throw new HttpError(413, `${rel} is too large.`);
  const full = safeJoin(dir, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Pulls `<file path="...">...</file>` blocks out of a model reply. */
export function parseFileBlocks(text: string): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  const re = /<file\s+path="([^"]+)">\n?([\s\S]*?)<\/file>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < 30) {
    out.push({ path: m[1].trim(), content: m[2].replace(/\n$/, "") + "\n" });
  }
  return out;
}

export const VIBE_SYSTEM = `You build small web projects (HTML, CSS, JavaScript) inside the user's project folder.
When you create or change files, output each one in full, exactly like this:
<file path="relative/path.ext">
...the whole file...
</file>
Always include an index.html entry point. Keep everything self-contained (no build step, no external CDNs unless asked).
After the files, add two or three sentences on what you built and how to use it.`;

function seedPlayground(): void {
  const dir = projectDir("playground");
  writeFile(dir, "index.html", `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Playground</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main>
    <h1>Hello from GUG-cli<span>.</span></h1>
    <p>Describe what you want in the vibe bar and Forge will build it here.</p>
  </main>
</body>
</html>
`);
  writeFile(dir, "style.css", `body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #030303; color: #f4f4f5; font-family: system-ui, sans-serif; }
h1 { font-weight: 300; font-size: 48px; margin: 0; }
h1 span { color: #ff2b3a; }
p { color: #a1a1aa; }
`);
}
