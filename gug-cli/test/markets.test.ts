import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-markets-"));
const { emptyMarkets, paperTrade, parseSymbol, quote, setAlert, stats } = await import("../src/server/markets.ts");

// A stand-in for Yahoo and CoinGecko, shaped like their real responses.
let calls = 0;
const fake = createServer((req, res) => {
  calls++;
  const url = new URL(req.url!, "http://x");
  res.setHeader("content-type", "application/json");
  if (url.pathname.startsWith("/v8/finance/chart/")) {
    const sym = decodeURIComponent(url.pathname.split("/").pop()!);
    if (sym === "NOPE") return res.end(JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }));
    return res.end(JSON.stringify({ chart: { result: [{ meta: { currency: "USD", symbol: sym, regularMarketPrice: 110, chartPreviousClose: 100, longName: "Apple Inc." }, timestamp: [1, 2, 3, 4], indicators: { quote: [{ close: [100, null, 90, 110] }] } }], error: null } }));
  }
  if (url.pathname === "/api/v3/simple/price") return res.end(JSON.stringify({ bitcoin: { usd: 50_000, usd_24h_change: 25 } }));
  if (url.pathname.startsWith("/api/v3/coins/bitcoin/market_chart")) return res.end(JSON.stringify({ prices: [[1000, 40_000], [2000, 50_000]] }));
  res.statusCode = 404;
  res.end("{}");
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
process.env.GUG_YAHOO_URL = base;
process.env.GUG_COINGECKO_URL = base;
after(() => fake.close());

test("symbols are recognised and sanitised", () => {
  assert.deepEqual(parseSymbol("btc"), { symbol: "bitcoin", kind: "crypto", label: "BTC" });
  assert.deepEqual(parseSymbol("vusa.l"), { symbol: "VUSA.L", kind: "stock", label: "VUSA.L" });
  assert.equal(parseSymbol("^gspc").symbol, "^GSPC");
  assert.equal(parseSymbol("pepe", "crypto").symbol, "pepe");
  assert.throws(() => parseSymbol("../etc/passwd"), /ticker/);
  assert.throws(() => parseSymbol(""), /Type a ticker/);
});

test("stock quotes parse Yahoo charts and skip gaps", async () => {
  const q = await quote(parseSymbol("AAPL"), "1m");
  assert.equal(q.price, 110);
  assert.equal(q.changePct, 10);
  assert.equal(q.name, "Apple Inc.");
  assert.deepEqual(q.history.map((p) => p[1]), [100, 90, 110]);
  const before = calls;
  await quote(parseSymbol("AAPL"), "1m");
  assert.equal(calls, before, "second call within a minute is cached");
  await assert.rejects(quote(parseSymbol("NOPE"), "1m"), /delisted/);
});

test("crypto quotes come from CoinGecko in USD", async () => {
  const q = await quote(parseSymbol("BTC"), "1w");
  assert.equal(q.price, 50_000);
  assert.equal(q.currency, "USD");
  assert.equal(q.changePct, 25);
  assert.equal(q.history.length, 2);
});

test("stats measure change, volatility and drawdown", () => {
  const s = stats([[1, 100], [2, 120], [3, 90], [4, 108]]);
  assert.equal(s.changePct, 8);
  assert.equal(s.high, 120);
  assert.equal(s.maxDrawdownPct, -25);
  assert.ok(s.volatilityPct > 0);
});

test("paper trading tracks cash and average cost", () => {
  const m = emptyMarkets();
  const q = { symbol: "AAPL", kind: "stock" as const, label: "AAPL", currency: "USD", price: 100 };
  paperTrade(m, q, "buy", 10);
  assert.equal(m.paper.cash, 9000);
  paperTrade(m, { ...q, price: 200 }, "buy", 10);
  assert.equal(m.paper.positions["stock:AAPL"].cost, 3000);
  paperTrade(m, { ...q, price: 300 }, "sell", 10);
  assert.equal(m.paper.cash, 10_000);
  assert.equal(m.paper.positions["stock:AAPL"].cost, 1500, "average cost carries over");
  assert.throws(() => paperTrade(m, q, "sell", 11), /only hold/);
  assert.throws(() => paperTrade(m, q, "buy", 1000), /Not enough paper cash/);
  assert.throws(() => paperTrade(m, { ...q, currency: "GBp" }, "buy", 1), /USD account/);
  paperTrade(m, q, "sell", 10);
  assert.equal(m.paper.positions["stock:AAPL"], undefined, "closed positions disappear");
});

test("alerts need sensible prices", () => {
  const m = emptyMarkets();
  m.watch.push({ ...parseSymbol("AAPL"), addedAt: "" });
  assert.throws(() => setAlert(m, "AAPL", "stock", { above: 100, below: 120 }), /lower/);
  assert.throws(() => setAlert(m, "AAPL", "stock", { above: -1 }), /positive/);
  assert.deepEqual(setAlert(m, "AAPL", "stock", { above: 150, below: "" }).alert, { above: 150, below: undefined });
  assert.equal(setAlert(m, "AAPL", "stock", {}).alert, undefined);
});

test("known coins keep their ticker however they're typed", () => {
  assert.equal(parseSymbol("bitcoin", "crypto").label, "BTC");
  assert.equal(parseSymbol("eth").label, "ETH");
  assert.equal(parseSymbol("pepe", "crypto").label, "pepe");
});
