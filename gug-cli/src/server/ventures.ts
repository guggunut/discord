// Ventures: a local income tracker for stores, games and digital products.
// Everything is entered by you (or loaded as clearly-labelled sample data) and
// stays in your local database. Ledger can review the numbers on request.
import { randomUUID } from "node:crypto";
import { agentById, systemFor } from "./agents.js";
import { runClaude } from "./engines/claude.js";
import type { GugEvent } from "./events.js";
import { HttpError, claudeKeys } from "./local.js";
import type { Store } from "./store.js";

export type StreamKind = "shopify" | "roblox" | "gumroad" | "etsy" | "youtube" | "other";
export type EntryType = "sale" | "cost" | "refund";
export interface Stream {
  id: string;
  name: string;
  kind: StreamKind;
  /** Robux streams are entered in R$ and converted with `rate` (home currency per R$). */
  robux: boolean;
  rate: number;
  sample?: boolean;
  createdAt: string;
  /** Roblox experience linked for live stats. */
  universeId?: number;
  /** Shopify store synced into this stream (token lives in the vault). */
  shop?: string;
  syncedAt?: string;
}
export interface Entry {
  id: string;
  streamId: string;
  date: string; // YYYY-MM-DD
  type: EntryType;
  amount: number; // always positive, in the stream's unit
  orders: number;
  note: string;
  sample?: boolean;
}
export interface Ventures {
  currency: "GBP" | "USD" | "EUR";
  /** Monthly profit target in the home currency. */
  goal?: number;
  streams: Stream[];
  entries: Entry[];
}

export const emptyVentures = (): Ventures => ({ currency: "GBP", streams: [], entries: [] });

const KINDS: StreamKind[] = ["shopify", "roblox", "gumroad", "etsy", "youtube", "other"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Roblox DevEx pays roughly $0.0035 per Robux; a sensible default you can change. */
export const DEFAULT_ROBUX_RATE = 0.0035;

export function validateStream(input: any, existing?: Stream): Stream {
  const name = String(input?.name ?? "").trim().slice(0, 40);
  if (!name) throw new HttpError(400, "Give the stream a name.");
  const kind: StreamKind = KINDS.includes(input?.kind) ? input.kind : "other";
  const robux = input?.robux === undefined ? kind === "roblox" : !!input.robux;
  const rate = Number(input?.rate ?? existing?.rate ?? DEFAULT_ROBUX_RATE);
  if (robux && !(rate > 0 && rate < 1)) throw new HttpError(400, "Robux rate should be a small number, like 0.0035.");
  return { id: existing?.id ?? randomUUID(), name, kind, robux, rate: robux ? rate : 1, sample: existing?.sample, createdAt: existing?.createdAt ?? new Date().toISOString(), universeId: kind === "roblox" ? existing?.universeId : undefined, shop: kind === "shopify" ? existing?.shop : undefined, syncedAt: existing?.syncedAt };
}

export function validateEntry(v: Ventures, input: any): Entry {
  const stream = v.streams.find((s) => s.id === input?.streamId);
  if (!stream) throw new HttpError(400, "Pick a stream for this entry.");
  const date = String(input?.date ?? "");
  if (!DAY.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, "Use a date like 2026-10-01.");
  const type: EntryType = (["sale", "cost", "refund"] as const).includes(input?.type) ? input.type : "sale";
  const amount = Math.round(Number(input?.amount) * 100) / 100;
  if (!(amount > 0 && amount < 1e9)) throw new HttpError(400, "Amount must be more than zero.");
  const orders = type === "sale" ? Math.max(0, Math.min(100_000, Math.round(Number(input?.orders ?? 1)) || 0)) : 0;
  return { id: randomUUID(), streamId: stream.id, date, type, amount, orders, note: String(input?.note ?? "").trim().slice(0, 120) };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export type Range = "7d" | "30d" | "90d" | "12m";
const RANGE_DAYS: Record<Range, number> = { "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

interface Totals {
  revenue: number;
  costs: number;
  refunds: number;
  profit: number;
  orders: number;
}
const zero = (): Totals => ({ revenue: 0, costs: 0, refunds: 0, profit: 0, orders: 0 });
const r2 = (n: number) => Math.round(n * 100) / 100;

function add(t: Totals, e: Entry, s: Stream) {
  const value = e.amount * (s.robux ? s.rate : 1);
  if (e.type === "sale") {
    t.revenue += value;
    t.orders += e.orders;
  } else if (e.type === "cost") t.costs += value;
  else t.refunds += value;
  t.profit = t.revenue - t.costs - t.refunds;
}
const round = (t: Totals): Totals => ({ revenue: r2(t.revenue), costs: r2(t.costs), refunds: r2(t.refunds), profit: r2(t.profit), orders: t.orders });
const pct = (now: number, before: number) => (before === 0 ? (now === 0 ? 0 : null) : Math.round(((now - before) / Math.abs(before)) * 1000) / 10);

/** Everything the Ventures screen needs, in the home currency. */
export function summarise(v: Ventures, range: Range, now = new Date()) {
  const days = RANGE_DAYS[range];
  const end = iso(now);
  const start = iso(addDays(now, -(days - 1)));
  const prevStart = iso(addDays(now, -(2 * days - 1)));
  const byId = new Map(v.streams.map((s) => [s.id, s]));
  const cur = zero();
  const prev = zero();
  const perStream = new Map<string, { now: Totals; before: Totals; rawSales: number }>();
  // One bucket per day for short ranges, per week for 90 days, per month for 12 months.
  const bucketOf = (date: string) => (range === "12m" ? date.slice(0, 7) : range === "90d" ? iso(addDays(new Date(date), -((new Date(date).getDay() + 6) % 7))) : date);
  const buckets: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const b = bucketOf(iso(addDays(now, -i)));
    if (buckets[buckets.length - 1] !== b) buckets.push(b);
  }
  const series = new Map(buckets.map((b) => [b, zero()]));
  for (const e of v.entries) {
    const s = byId.get(e.streamId);
    if (!s || e.date > end || e.date < prevStart) continue;
    const ps = perStream.get(s.id) ?? { now: zero(), before: zero(), rawSales: 0 };
    perStream.set(s.id, ps);
    if (e.date >= start) {
      add(cur, e, s);
      add(ps.now, e, s);
      if (e.type === "sale") ps.rawSales += e.amount;
      const t = series.get(bucketOf(e.date));
      if (t) add(t, e, s);
    } else {
      add(prev, e, s);
      add(ps.before, e, s);
    }
  }
  const margin = (t: Totals) => (t.revenue > 0 ? Math.round((t.profit / t.revenue) * 1000) / 10 : 0);
  // Month to date, for the goal.
  const monthStart = `${end.slice(0, 7)}-01`;
  const month = zero();
  for (const e of v.entries) {
    const st = byId.get(e.streamId);
    if (st && e.date >= monthStart && e.date <= end) add(month, e, st);
  }
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return {
    currency: v.currency,
    month: { profit: r2(month.profit), goal: v.goal ?? null, dayOfMonth: now.getDate(), daysInMonth: dim },
    range,
    from: start,
    to: end,
    kpis: {
      revenue: { value: r2(cur.revenue), change: pct(cur.revenue, prev.revenue) },
      profit: { value: r2(cur.profit), change: pct(cur.profit, prev.profit) },
      orders: { value: cur.orders, change: pct(cur.orders, prev.orders) },
      margin: { value: margin(cur), change: prev.revenue > 0 ? Math.round((margin(cur) - margin(prev)) * 10) / 10 : null },
    },
    series: buckets.map((b) => ({ label: b, ...round(series.get(b)!) })),
    streams: v.streams.map((s) => {
      const ps = perStream.get(s.id) ?? { now: zero(), before: zero(), rawSales: 0 };
      return { ...s, totals: round(ps.now), margin: margin(ps.now), change: pct(ps.now.profit, ps.before.profit), rawSales: r2(ps.rawSales) };
    }),
    recent: [...v.entries].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1)).slice(0, 12),
    hasSample: v.streams.some((s) => s.sample),
  };
}

/** Clearly-labelled demo data so the screen isn't empty on day one. */
export function sampleData(now = new Date()): { streams: Stream[]; entries: Entry[] } {
  const mk = (name: string, kind: StreamKind, robux = false): Stream => ({ id: randomUUID(), name, kind, robux, rate: robux ? DEFAULT_ROBUX_RATE : 1, sample: true, createdAt: now.toISOString() });
  const store = mk("Lumen Desk Co.", "shopify");
  const game = mk("Sky Obby", "roblox", true);
  const presets = mk("Setup presets", "gumroad");
  const entries: Entry[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 400; i++) {
    const date = iso(addDays(now, -i));
    const growth = 1 + (400 - i) / 500;
    const orders = Math.round((2 + rnd() * 5) * growth);
    entries.push({ id: randomUUID(), streamId: store.id, date, type: "sale", amount: r2(orders * 34.99), orders, note: "Daily orders", sample: true });
    entries.push({ id: randomUUID(), streamId: store.id, date, type: "cost", amount: r2(orders * (11.4 + 8)), orders: 0, note: "Landed cost + ads", sample: true });
    if (rnd() < 0.08) entries.push({ id: randomUUID(), streamId: store.id, date, type: "refund", amount: 34.99, orders: 0, note: "Refund", sample: true });
    const passes = Math.round((3 + rnd() * 8) * growth);
    entries.push({ id: randomUUID(), streamId: game.id, date, type: "sale", amount: passes * 249 * 0.7, orders: passes, note: "VIP passes (after Roblox fee)", sample: true });
    if (i % 7 === 0) {
      const dl = Math.round(2 + rnd() * 6);
      entries.push({ id: randomUUID(), streamId: presets.id, date, type: "sale", amount: r2(dl * 12), orders: dl, note: "Weekly downloads", sample: true });
    }
  }
  return { streams: [store, game, presets], entries };
}

/** Ledger reviews the current numbers and suggests what to do next. */
export async function* reviewWithLedger(store: Store, v: Ventures, range: Range, question: string, signal?: AbortSignal): AsyncGenerator<GugEvent> {
  const s = summarise(v, range);
  const facts = {
    currency: s.currency,
    period: `${s.from} to ${s.to}`,
    kpis: s.kpis,
    streams: s.streams.map((x) => ({ name: x.name, kind: x.kind, robux: x.robux, revenue: x.totals.revenue, costs: x.totals.costs, refunds: x.totals.refunds, profit: x.totals.profit, orders: x.totals.orders, margin: x.margin, profitChangePct: x.change })),
    trend: s.series.map((p) => [p.label, p.revenue, p.profit]),
  };
  const ask = question.trim() || "Review these numbers. What is working, what is leaking money, and the 3 most useful things I should do this week?";
  const prompt = `${ask}\n\nMy numbers (JSON, amounts in ${s.currency}, null change means no previous data):\n${JSON.stringify(facts)}\n\nBe concrete, use my actual numbers, keep it under 250 words, and remind me briefly that this isn't professional financial advice.`;
  const ledger = agentById("ledger")!;
  yield* runClaude({ keys: claudeKeys(store), system: systemFor(ledger), messages: [{ role: "user", content: prompt }], mode: "deep", agent: "ledger", signal, maxTokens: 2000 });
}
