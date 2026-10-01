// Markets: a watchlist with live quotes, price alerts, and a paper-trading
// account. Quotes come from public endpoints (Yahoo Finance charts for stocks
// and funds, CoinGecko for crypto) — no keys, may be delayed. Nothing here
// places real trades.
import { randomUUID } from "node:crypto";
import { agentById, systemFor } from "./agents.js";
import { runClaude } from "./engines/claude.js";
import type { GugEvent } from "./events.js";
import { HttpError, claudeKeys } from "./local.js";
import type { Store } from "./store.js";

export type AssetKind = "stock" | "crypto";
export type Span = "1d" | "1w" | "1m" | "6m" | "1y";
export interface WatchItem {
  symbol: string; // AAPL, VUSA.L, ^GSPC, or a CoinGecko id such as "bitcoin"
  kind: AssetKind;
  label: string; // what the user typed / sees (BTC)
  addedAt: string;
  alert?: { above?: number; below?: number; firedAt?: string };
}
export interface Trade {
  id: string;
  at: string;
  symbol: string;
  kind: AssetKind;
  label: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
}
export interface Paper {
  cash: number;
  start: number;
  positions: Record<string, { kind: AssetKind; label: string; qty: number; cost: number }>;
  trades: Trade[];
}
export interface Markets {
  watch: WatchItem[];
  paper: Paper;
}
export interface Quote {
  symbol: string;
  kind: AssetKind;
  label: string;
  name: string;
  currency: string;
  price: number;
  prevClose: number;
  change: number;
  changePct: number;
  history: [number, number][];
  stale?: boolean;
}

export const emptyMarkets = (): Markets => ({ watch: [], paper: { cash: 10_000, start: 10_000, positions: {}, trades: [] } });

const YAHOO = () => process.env.GUG_YAHOO_URL ?? "https://query1.finance.yahoo.com";
const GECKO = () => process.env.GUG_COINGECKO_URL ?? "https://api.coingecko.com";
const UA = { "user-agent": "Mozilla/5.0 (GUG-cli; personal watchlist)", accept: "application/json" };

const CRYPTO: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin", XRP: "ripple", ADA: "cardano", LTC: "litecoin",
  BNB: "binancecoin", AVAX: "avalanche-2", DOT: "polkadot", LINK: "chainlink", MATIC: "matic-network", USDT: "tether", USDC: "usd-coin",
};
const STOCK_RE = /^[A-Z0-9^][A-Z0-9.^=-]{0,14}$/;
const GECKO_RE = /^[a-z0-9-]{2,50}$/;

/** Turns what someone typed ("btc", "aapl", "vusa.l") into a watch item. */
export function parseSymbol(input: string, kind?: AssetKind): Omit<WatchItem, "addedAt"> {
  const raw = String(input ?? "").trim();
  if (!raw) throw new HttpError(400, "Type a ticker like AAPL or BTC.");
  const up = raw.toUpperCase();
  if (kind === "crypto" || (!kind && CRYPTO[up])) {
    const id = CRYPTO[up] ?? raw.toLowerCase();
    if (!GECKO_RE.test(id)) throw new HttpError(400, "That doesn't look like a coin. Try BTC, ETH or a CoinGecko id.");
    // Known coins always show their ticker, whether you typed "btc" or "bitcoin".
    const ticker = Object.keys(CRYPTO).find((k) => CRYPTO[k] === id);
    return { symbol: id, kind: "crypto", label: ticker ?? id };
  }
  if (!STOCK_RE.test(up)) throw new HttpError(400, "That doesn't look like a ticker. Try AAPL, TSLA or VUSA.L.");
  return { symbol: up, kind: "stock", label: up };
}

const keyOf = (w: { kind: AssetKind; symbol: string }) => `${w.kind}:${w.symbol}`;
const YRANGE: Record<Span, [string, string]> = { "1d": ["1d", "5m"], "1w": ["5d", "30m"], "1m": ["1mo", "1d"], "6m": ["6mo", "1d"], "1y": ["1y", "1wk"] };
const GDAYS: Record<Span, number> = { "1d": 1, "1w": 7, "1m": 30, "6m": 180, "1y": 365 };

const cache = new Map<string, { at: number; q: Quote }>();
const TTL = 60_000;

async function getJson(url: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(url, { headers: UA, signal: signal ?? AbortSignal.timeout(10_000) });
  if (res.status === 429) throw new HttpError(429, "The price service is rate-limiting us — try again in a minute.");
  if (!res.ok) throw new HttpError(502, `Price service said ${res.status}.`);
  return res.json();
}

async function yahoo(w: Omit<WatchItem, "addedAt">, span: Span): Promise<Quote> {
  const [range, interval] = YRANGE[span];
  const j = await getJson(`${YAHOO()}/v8/finance/chart/${encodeURIComponent(w.symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
  const r = j?.chart?.result?.[0];
  if (!r) throw new HttpError(404, j?.chart?.error?.description ?? `No prices for ${w.label}.`);
  const closes: (number | null)[] = r.indicators?.quote?.[0]?.close ?? [];
  const history: [number, number][] = (r.timestamp ?? []).map((t: number, i: number) => [t * 1000, closes[i]] as [number, number | null]).filter((p: [number, number | null]) => typeof p[1] === "number");
  const m = r.meta ?? {};
  const price = Number(m.regularMarketPrice ?? history.at(-1)?.[1] ?? 0);
  const prevClose = Number(m.chartPreviousClose ?? m.previousClose ?? history[0]?.[1] ?? price);
  return finish(w, { name: String(m.longName ?? m.shortName ?? w.label), currency: String(m.currency ?? "USD"), price, prevClose, history });
}

async function gecko(w: Omit<WatchItem, "addedAt">, span: Span): Promise<Quote> {
  const [chart, simple] = await Promise.all([
    getJson(`${GECKO()}/api/v3/coins/${encodeURIComponent(w.symbol)}/market_chart?vs_currency=usd&days=${GDAYS[span]}`),
    getJson(`${GECKO()}/api/v3/simple/price?ids=${encodeURIComponent(w.symbol)}&vs_currencies=usd&include_24hr_change=true`),
  ]);
  const history: [number, number][] = (chart?.prices ?? []).filter((p: unknown) => Array.isArray(p) && typeof p[1] === "number");
  const s = simple?.[w.symbol];
  if (!s && !history.length) throw new HttpError(404, `CoinGecko doesn't know “${w.label}”. Try its id, like “bitcoin”.`);
  const price = Number(s?.usd ?? history.at(-1)?.[1]);
  const pct = Number(s?.usd_24h_change ?? 0);
  return finish(w, { name: w.symbol.charAt(0).toUpperCase() + w.symbol.slice(1).replaceAll("-", " "), currency: "USD", price, prevClose: price / (1 + pct / 100), history });
}

function finish(w: Omit<WatchItem, "addedAt">, q: Pick<Quote, "name" | "currency" | "price" | "prevClose" | "history">): Quote {
  const change = q.price - q.prevClose;
  return { symbol: w.symbol, kind: w.kind, label: w.label, ...q, change: round(change, 4), changePct: q.prevClose ? round((change / q.prevClose) * 100, 2) : 0 };
}
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

/** A cached quote (60 s). Falls back to the last good quote, marked stale, if the service fails. */
export async function quote(w: Omit<WatchItem, "addedAt">, span: Span = "1m"): Promise<Quote> {
  const k = `${keyOf(w)}:${span}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.q;
  try {
    const q = w.kind === "crypto" ? await gecko(w, span) : await yahoo(w, span);
    cache.set(k, { at: Date.now(), q });
    return q;
  } catch (err) {
    if (hit) return { ...hit.q, stale: true };
    throw err;
  }
}

/** Plain stats Quant (and the UI) can reason about. */
export function stats(history: [number, number][]) {
  const px = history.map((p) => p[1]).filter((n) => Number.isFinite(n) && n > 0);
  if (px.length < 2) return { first: px[0] ?? 0, last: px[0] ?? 0, high: px[0] ?? 0, low: px[0] ?? 0, changePct: 0, volatilityPct: 0, maxDrawdownPct: 0, points: px.length };
  const rets = px.slice(1).map((p, i) => p / px[i] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  let peak = px[0];
  let dd = 0;
  for (const p of px) {
    peak = Math.max(peak, p);
    dd = Math.min(dd, p / peak - 1);
  }
  return { first: px[0], last: px.at(-1)!, high: Math.max(...px), low: Math.min(...px), changePct: round((px.at(-1)! / px[0] - 1) * 100), volatilityPct: round(sd * 100), maxDrawdownPct: round(dd * 100), points: px.length };
}

export function setAlert(m: Markets, symbol: string, kind: AssetKind, alert: { above?: unknown; below?: unknown }) {
  const w = m.watch.find((x) => x.symbol === symbol && x.kind === kind);
  if (!w) throw new HttpError(404, "Not on your watchlist.");
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v) > 0 ? Number(v) : NaN);
  const above = num(alert.above);
  const below = num(alert.below);
  if (Number.isNaN(above) || Number.isNaN(below)) throw new HttpError(400, "Alert prices must be positive numbers.");
  if (above !== undefined && below !== undefined && below >= above) throw new HttpError(400, "“Below” must be lower than “above”.");
  w.alert = above === undefined && below === undefined ? undefined : { above, below };
  return w;
}

/** Paper trading only — fills at the latest quote, no fees, USD-quoted assets. */
export function paperTrade(m: Markets, q: Pick<Quote, "symbol" | "kind" | "label" | "price" | "currency">, side: "buy" | "sell", qtyIn: unknown): Trade {
  if (q.currency !== "USD") throw new HttpError(400, `Paper trading uses a USD account; ${q.label} is priced in ${q.currency}.`);
  const qty = Number(qtyIn);
  if (!(qty > 0 && qty < 1e9)) throw new HttpError(400, "Quantity must be more than zero.");
  const k = keyOf(q);
  const pos = m.paper.positions[k] ?? { kind: q.kind, label: q.label, qty: 0, cost: 0 };
  const value = qty * q.price;
  if (side === "buy") {
    if (value > m.paper.cash + 1e-9) throw new HttpError(400, `Not enough paper cash — you have $${m.paper.cash.toFixed(2)}.`);
    m.paper.cash = round(m.paper.cash - value, 6);
    pos.cost += value;
    pos.qty += qty;
  } else {
    if (qty > pos.qty + 1e-9) throw new HttpError(400, `You only hold ${pos.qty} ${q.label}.`);
    const avg = pos.qty ? pos.cost / pos.qty : 0;
    pos.cost -= avg * qty;
    pos.qty -= qty;
    m.paper.cash = round(m.paper.cash + value, 6);
  }
  if (pos.qty <= 1e-9) delete m.paper.positions[k];
  else m.paper.positions[k] = { ...pos, qty: round(pos.qty, 8), cost: round(pos.cost, 6) };
  const t: Trade = { id: randomUUID(), at: new Date().toISOString(), symbol: q.symbol, kind: q.kind, label: q.label, side, qty, price: q.price };
  m.paper.trades = [t, ...m.paper.trades].slice(0, 200);
  return t;
}

/** Checks alerts every 5 minutes; a fired alert lands in the inbox once per crossing. */
export function startAlertWatcher(store: Store): () => void {
  // Older data may have coins labelled by their id ("bitcoin"); show tickers instead.
  for (const w of store.data.markets.watch) if (w.kind === "crypto") w.label = parseSymbol(w.symbol, "crypto").label;
  const tick = async () => {
    for (const w of store.data.markets.watch) {
      if (!w.alert || w.alert.firedAt) continue;
      try {
        const q = await quote(w, "1d");
        const hit = (w.alert.above !== undefined && q.price >= w.alert.above && `rose above ${w.alert.above}`) || (w.alert.below !== undefined && q.price <= w.alert.below && `fell below ${w.alert.below}`);
        if (!hit) continue;
        w.alert.firedAt = new Date().toISOString();
        store.data.inbox = [{ id: randomUUID(), flowId: "markets", title: `${w.label} ${hit}`, body: `${w.label} is at **${q.price} ${q.currency}** (${q.changePct >= 0 ? "+" : ""}${q.changePct}% today). Reset the alert in Markets to watch for the next move.`, at: w.alert.firedAt, read: false }, ...store.data.inbox].slice(0, 100);
        store.save();
      } catch {
        /* service down — try again next tick */
      }
    }
  };
  const t = setInterval(() => void tick(), 5 * 60_000);
  return () => clearInterval(t);
}

/** Quant explains what the chart shows, in plain English. */
export async function* quantRead(store: Store, q: Quote, span: Span, question: string, signal?: AbortSignal): AsyncGenerator<GugEvent> {
  const s = stats(q.history);
  const facts = { asset: `${q.name} (${q.label})`, kind: q.kind, currency: q.currency, price: q.price, todayChangePct: q.changePct, window: span, ...s };
  const ask = question.trim() || "What has this done over this window, how volatile is it, and what should a beginner keep in mind before buying?";
  const prompt = `${ask}\n\nData (computed from public prices, may be delayed):\n${JSON.stringify(facts)}\n\nExplain in plain English using these numbers, under 200 words. Don't predict prices or tell me to buy or sell; end with a one-line reminder that this isn't financial advice.`;
  yield* runClaude({ keys: claudeKeys(store), system: systemFor(agentById("quant")!), messages: [{ role: "user", content: prompt }], mode: "deep", agent: "quant", signal, maxTokens: 1500 });
}
