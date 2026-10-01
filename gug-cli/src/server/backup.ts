// Backups: everything you've made in GUG-cli as one JSON file — never your keys.
// Restoring re-validates every record, so a hand-edited or foreign file can't
// smuggle in bad data, scripts or secrets.
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { validateFlow } from "./flows.js";
import { validatePost } from "./growth.js";
import { HttpError } from "./local.js";
import { parseSymbol } from "./markets.js";
import { readArt, sanitizeSvg } from "./studio.js";
import type { ChatMessage, Store } from "./store.js";
import { validateEntry, validateStream } from "./ventures.js";

export const BACKUP_KIND = "gug-cli-backup";

export function makeBackup(store: Store, opts: { chats: boolean }) {
  const d = store.data;
  const art = d.studio.art.flatMap((a) => {
    try {
      return [{ ...a, svg: readArt(a.id) }];
    } catch {
      return [];
    }
  });
  return {
    kind: BACKUP_KIND,
    version: 1,
    createdAt: new Date().toISOString(),
    profile: d.profile,
    prefs: d.prefs,
    flows: d.flows,
    inbox: d.inbox,
    ventures: d.ventures,
    markets: d.markets,
    growth: d.growth,
    studio: { art },
    chats: opts.chats ? d.chats : undefined,
  };
}

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
/** Keeps the items that validate; counts the ones that don't. */
function keep<T>(items: any[], fn: (x: any) => T, skipped: { n: number }): T[] {
  const out: T[] = [];
  for (const x of items) {
    try {
      out.push(fn(x));
    } catch {
      skipped.n++;
    }
  }
  return out;
}

/** Replaces your data with the backup's, after validating every record. Keys stay untouched. */
export function restoreBackup(store: Store, b: any) {
  if (b?.kind !== BACKUP_KIND || b?.version !== 1) throw new HttpError(400, "That isn't a GUG-cli backup file.");
  const skipped = { n: 0 };
  const d = store.data;

  const flows = keep(arr(b.flows).slice(0, 50), (f) => ({ ...validateFlow(f), lastRunAt: typeof f.lastRunAt === "string" ? f.lastRunAt : undefined }), skipped);
  const inbox = keep(arr(b.inbox).slice(0, 100), (i) => {
    if (typeof i?.title !== "string" || typeof i?.body !== "string") throw new Error("bad");
    return { id: randomUUID(), flowId: String(i.flowId ?? ""), title: i.title.slice(0, 200), body: i.body.slice(0, 8000), at: String(i.at ?? new Date().toISOString()), read: !!i.read };
  }, skipped);

  // Streams get fresh ids; entries are re-pointed at them.
  const ids = new Map<string, string>();
  const streams = keep(arr(b.ventures?.streams).slice(0, 30), (s) => {
    const v = { ...validateStream(s), sample: !!s.sample };
    ids.set(String(s.id), v.id);
    return v;
  }, skipped);
  const ventures = { currency: ["GBP", "USD", "EUR"].includes(b.ventures?.currency) ? b.ventures.currency : d.ventures.currency, streams, entries: [] as ReturnType<typeof validateEntry>[] };
  ventures.entries = keep(arr(b.ventures?.entries).slice(0, 20_000), (e) => ({ ...validateEntry(ventures, { ...e, streamId: ids.get(String(e.streamId)) }), sample: !!e.sample }), skipped);

  const watch = keep(arr(b.markets?.watch).slice(0, 30), (w) => ({ ...parseSymbol(w.kind === "crypto" ? w.symbol : w.symbol, w.kind), addedAt: String(w.addedAt ?? new Date().toISOString()) }), skipped);
  const p = b.markets?.paper;
  const paper = p && Number.isFinite(p.cash) && Number.isFinite(p.start) && typeof p.positions === "object" ? { cash: Number(p.cash), start: Number(p.start), positions: Object.fromEntries(Object.entries(p.positions as Record<string, any>).filter(([, x]) => x && Number(x.qty) > 0 && Number.isFinite(Number(x.cost))).map(([k, x]) => [k, { kind: x.kind === "crypto" ? "crypto" : "stock", label: String(x.label ?? k).slice(0, 40), qty: Number(x.qty), cost: Number(x.cost) }])) as typeof d.markets.paper.positions, trades: keep(arr(p.trades).slice(0, 200), (t) => ({ id: randomUUID(), at: String(t.at ?? ""), symbol: String(t.symbol).slice(0, 60), kind: t.kind === "crypto" ? ("crypto" as const) : ("stock" as const), label: String(t.label ?? t.symbol).slice(0, 40), side: t.side === "sell" ? ("sell" as const) : ("buy" as const), qty: Number(t.qty) || 0, price: Number(t.price) || 0 }), skipped) } : d.markets.paper;

  const posts = keep(arr(b.growth?.posts).slice(0, 2000), (x) => validatePost(x), skipped);

  mkdirSync(path.join(config.dataDir, "studio"), { recursive: true, mode: 0o700 });
  const oldArt = d.studio.art.map((a) => path.join(config.dataDir, "studio", `${a.id}.svg`));
  const art = keep(arr(b.studio?.art).slice(0, 200), (a) => {
    const svg = sanitizeSvg(String(a.svg ?? ""));
    const id = randomUUID();
    writeFileSync(path.join(config.dataDir, "studio", `${id}.svg`), svg, { mode: 0o600 });
    return { id, title: String(a.title ?? "Artwork").slice(0, 60), prompt: String(a.prompt ?? "").slice(0, 1500), style: String(a.style ?? "neon").slice(0, 20), at: String(a.at ?? new Date().toISOString()), bytes: svg.length };
  }, skipped);

  let chats = d.chats;
  if (b.chats && typeof b.chats === "object") {
    chats = {};
    for (const [agent, msgs] of Object.entries(b.chats as Record<string, unknown>)) {
      if (!/^[a-z]{2,20}$/.test(agent)) continue;
      chats[agent] = arr(msgs)
        .filter((m): m is ChatMessage => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
        .slice(-200)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 50_000), at: String(m.at ?? ""), engine: typeof m.engine === "string" ? m.engine : undefined, model: typeof m.model === "string" ? m.model : undefined }));
    }
  }

  if (typeof b.profile?.name === "string") d.profile.name = b.profile.name.slice(0, 40);
  d.flows = flows;
  d.inbox = inbox;
  d.ventures = ventures;
  d.markets = { watch, paper };
  d.growth = { brand: String(b.growth?.brand ?? "").slice(0, 300), posts };
  d.studio = { art };
  for (const f of oldArt) rmSync(f, { force: true });
  d.chats = chats;
  store.save();
  return { flows: flows.length, streams: streams.length, entries: ventures.entries.length, watch: watch.length, posts: posts.length, art: art.length, skipped: skipped.n };
}
