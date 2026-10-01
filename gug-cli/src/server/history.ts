// "Undo build": before Forge touches a project we snapshot its files, so you can
// see exactly what a build changed (a line diff per file) and roll it back.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { HttpError } from "./local.js";
import { listFiles, safeJoin } from "./workspace.js";

const MAX_SNAPSHOT = 8 * 1024 * 1024;

export interface Snapshot {
  at: string;
  prompt: string;
  /** path → base64 content */
  files: Record<string, string>;
}
export type DiffLine = [" " | "+" | "-", string];
export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  added: number;
  removed: number;
  /** Hunks of the line diff (3 lines of context); null for binary or very large files. */
  hunks: { at: number; lines: DiffLine[] }[] | null;
}

const file = (project: string) => path.join(config.dataDir, "history", `${project}.json`);

function read(dir: string): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  for (const f of listFiles(dir)) out[f.path] = readFileSync(safeJoin(dir, f.path));
  return out;
}

/** Remember the project as it is now. Returns false when it's too big to keep a copy. */
export function takeSnapshot(project: string, dir: string, prompt: string): boolean {
  const now = read(dir);
  const size = Object.values(now).reduce((a, b) => a + b.length, 0);
  if (size > MAX_SNAPSHOT) return false;
  const snap: Snapshot = { at: new Date().toISOString(), prompt: prompt.slice(0, 300), files: Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v.toString("base64")])) };
  mkdirSync(path.dirname(file(project)), { recursive: true, mode: 0o700 });
  writeFileSync(file(project), JSON.stringify(snap), { mode: 0o600 });
  return true;
}

export function getSnapshot(project: string): Snapshot | null {
  try {
    return JSON.parse(readFileSync(file(project), "utf8"));
  } catch {
    return null;
  }
}

const isText = (b: Buffer) => !b.subarray(0, 4000).includes(0);

/** Line diff via LCS. Gives up (null) on very large inputs. */
export function diffLines(a: string[], b: string[]): DiffLine[] | null {
  // Trim the common head and tail first — most edits are local.
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const A = a.slice(s, a.length - e);
  const B = b.slice(s, b.length - e);
  const n = A.length;
  const m = B.length;
  if ((n + 1) * (m + 1) > 4_000_000) return null;
  const w = m + 1;
  const L = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * w + j] = A[i] === B[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
  const out: DiffLine[] = a.slice(0, s).map((l) => [" ", l]);
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) (out.push([" ", A[i]]), i++, j++);
    else if (i < n && (j === m || L[(i + 1) * w + j] >= L[i * w + j + 1])) out.push(["-", A[i++]]);
    else out.push(["+", B[j++]]);
  }
  for (const l of a.slice(a.length - e)) out.push([" ", l]);
  return out;
}

/** Groups a diff into hunks with `ctx` lines of context around each change. */
export function hunks(lines: DiffLine[], ctx = 3): { at: number; lines: DiffLine[] }[] {
  const keep = new Uint8Array(lines.length);
  lines.forEach(([k], i) => {
    if (k !== " ") for (let d = -ctx; d <= ctx; d++) if (i + d >= 0 && i + d < lines.length) keep[i + d] = 1;
  });
  const out: { at: number; lines: DiffLine[] }[] = [];
  let lineNo = 0;
  let cur: { at: number; lines: DiffLine[] } | null = null;
  lines.forEach((l, i) => {
    if (l[0] !== "+") lineNo++;
    if (!keep[i]) return void (cur = null);
    if (!cur) out.push((cur = { at: Math.max(1, lineNo), lines: [] }));
    cur.lines.push(l);
  });
  return out.slice(0, 40);
}

const split = (s: string) => s.replace(/\n$/, "").split("\n");

/** What changed in the project since the last snapshot. */
export function changes(project: string, dir: string): { snapshot: Omit<Snapshot, "files"> | null; files: FileChange[] } {
  const snap = getSnapshot(project);
  if (!snap) return { snapshot: null, files: [] };
  const now = read(dir);
  const before = Object.fromEntries(Object.entries(snap.files).map(([k, v]) => [k, Buffer.from(v, "base64")]));
  const out: FileChange[] = [];
  for (const p of [...new Set([...Object.keys(before), ...Object.keys(now)])].sort()) {
    const a = before[p];
    const b = now[p];
    if (a && b && a.equals(b)) continue;
    const status = !a ? "added" : !b ? "deleted" : "modified";
    const text = (!a || isText(a)) && (!b || isText(b));
    const d = text ? diffLines(a ? split(a.toString("utf8")) : [], b ? split(b.toString("utf8")) : []) : null;
    out.push({
      path: p,
      status,
      added: d ? d.filter((l) => l[0] === "+").length : 0,
      removed: d ? d.filter((l) => l[0] === "-").length : 0,
      hunks: d ? hunks(d) : null,
    });
  }
  const { files: _files, ...meta } = snap;
  return { snapshot: meta, files: out.slice(0, 60) };
}

/** Puts every file back the way it was before the last build. */
export function undo(project: string, dir: string): number {
  const snap = getSnapshot(project);
  if (!snap) throw new HttpError(404, "Nothing to undo — no build has run here yet.");
  const now = read(dir);
  let n = 0;
  for (const p of Object.keys(now)) {
    if (!(p in snap.files)) (rmSync(safeJoin(dir, p), { force: true }), n++);
  }
  for (const [p, b64] of Object.entries(snap.files)) {
    const buf = Buffer.from(b64, "base64");
    if (now[p]?.equals(buf)) continue;
    const full = safeJoin(dir, p);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, buf);
    n++;
  }
  rmSync(file(project), { force: true });
  return n;
}

export const hasSnapshot = (project: string) => existsSync(file(project));
