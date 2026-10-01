import { useEffect, useRef, useState } from "react";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { Md } from "../Md";
import { play } from "../sfx";
import { Icon, P, Seg, Sigil } from "../ui";

type Span = "1d" | "1w" | "1m" | "6m" | "1y";
type Kind = "stock" | "crypto";
interface Quote { symbol: string; kind: Kind; label: string; name: string; currency: string; price: number; prevClose: number; change: number; changePct: number; history: [number, number][]; stale?: boolean }
interface Stats { first: number; last: number; high: number; low: number; changePct: number; volatilityPct: number; maxDrawdownPct: number; points: number }
interface Watch { symbol: string; kind: Kind; label: string; alert?: { above?: number; below?: number; firedAt?: string }; quote?: Quote; error?: string }
interface Position { symbol: string; kind: Kind; label: string; qty: number; cost: number; price: number | null; value: number | null }
interface Trade { id: string; at: string; label: string; side: "buy" | "sell"; qty: number; price: number }
interface Data { span: Span; watch: Watch[]; paper: { cash: number; start: number; positions: Position[]; trades: Trade[] } }

const QUICK: [string, string][] = [["AAPL", "Apple"], ["NVDA", "Nvidia"], ["TSLA", "Tesla"], ["^GSPC", "S&P 500"], ["VUSA.L", "Vanguard S&P (LSE)"], ["BTC", "Bitcoin"], ["ETH", "Ethereum"], ["SOL", "Solana"]];

export function fmt(n: number | null | undefined, cur = "USD", digits?: number) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const d = digits ?? (Math.abs(n) >= 1000 ? 0 : Math.abs(n) >= 1 ? 2 : 4);
  if (cur === "GBp" || cur === "GBX") return `${n.toLocaleString(undefined, { maximumFractionDigits: d })}p`;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: d, minimumFractionDigits: Math.min(d, 2) }).format(n);
  } catch {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: d })} ${cur}`;
  }
}
const pctTxt = (n: number) => `${n >= 0 ? "▲" : "▼"} ${Math.abs(n).toFixed(2)}%`;

export function Markets() {
  const { toast, state } = useApp();
  const [span, setSpan] = useState<Span>("1m");
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<{ symbol: string; kind: Kind } | null>(null);
  const [cur, setCur] = useState<(Quote & { stats: Stats }) | null>(null);
  const [curErr, setCurErr] = useState("");
  const [find, setFind] = useState("");
  const [adding, setAdding] = useState(false);
  const [read, setRead] = useState("");
  const [reading, setReading] = useState(false);
  const [qty, setQty] = useState("1");
  const [alert, setAlertDraft] = useState({ above: "", below: "" });
  const abortRef = useRef<() => void>(() => {});

  const load = async (s = span) => {
    const d = await api<Data>(`/api/markets?span=${s}`);
    setData(d);
    if (!sel && d.watch[0]) setSel({ symbol: d.watch[0].symbol, kind: d.watch[0].kind });
    return d;
  };
  useEffect(() => {
    void load(span).catch((e) => toast((e as Error).message, "err"));
    const t = window.setInterval(() => void load(span).catch(() => {}), 60_000);
    return () => window.clearInterval(t);
  }, [span]);
  useEffect(() => () => abortRef.current(), []);
  // A ticker handed over from the command palette.
  useEffect(() => {
    const t = localStorage.getItem("gug-markets-add");
    localStorage.removeItem("gug-markets-add");
    if (t) void add(t);
  }, []);

  useEffect(() => {
    if (!sel) return setCur(null);
    setCurErr("");
    setRead("");
    abortRef.current();
    const w = data?.watch.find((x) => x.symbol === sel.symbol && x.kind === sel.kind);
    setAlertDraft({ above: w?.alert?.above?.toString() ?? "", below: w?.alert?.below?.toString() ?? "" });
    api<Quote & { stats: Stats }>(`/api/markets/quote?symbol=${encodeURIComponent(sel.kind === "crypto" ? sel.symbol : sel.symbol)}&kind=${sel.kind}&span=${span}`)
      .then(setCur)
      .catch((e) => (setCur(null), setCurErr((e as Error).message)));
  }, [sel?.symbol, sel?.kind, span]);

  const add = async (symbol: string) => {
    if (!symbol.trim()) return;
    setAdding(true);
    try {
      const w = await api<Watch>("/api/markets/watch", { body: { symbol } });
      play("success");
      setFind("");
      await load();
      setSel({ symbol: w.symbol, kind: w.kind });
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setAdding(false);
    }
  };
  const remove = async (w: Watch) => {
    await api(`/api/markets/watch/${w.kind}/${encodeURIComponent(w.symbol)}`, { method: "DELETE" });
    if (sel?.symbol === w.symbol) setSel(null);
    await load();
  };
  const saveAlert = async () => {
    if (!sel) return;
    try {
      await api("/api/markets/alert", { method: "PUT", body: { ...sel, above: alert.above, below: alert.below } });
      toast(alert.above || alert.below ? "Alert set — it lands in your Flows inbox." : "Alert cleared.");
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const trade = async (side: "buy" | "sell") => {
    if (!sel) return;
    try {
      await api("/api/markets/paper", { body: { ...sel, side, qty: Number(qty) } });
      toast(`Paper ${side === "buy" ? "bought" : "sold"} ${qty} ${cur?.label ?? ""}.`);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const askQuant = (question = "") => {
    if (!sel) return;
    play("send");
    setRead("");
    setReading(true);
    abortRef.current = stream("/api/markets/read", { ...sel, span, question }, (ev: GugEvent) => {
      if (ev.type === "text") setRead((r) => r + ev.text);
      if (ev.type === "error") setRead((r) => `${r}\n\n**Couldn’t finish:** ${ev.message}`);
    }, () => setReading(false));
  };

  if (!data) return <div className="muted">Loading prices…</div>;
  const paper = data.paper;
  const invested = paper.positions.reduce((a, p) => a + (p.value ?? p.cost), 0);
  const total = paper.cash + invested;
  const pnl = total - paper.start;
  const live = data.watch.filter((w) => w.quote);
  // The marquee scrolls by half its width, so the strip is one long run repeated twice.
  const run = live.length ? Array.from({ length: Math.ceil(10 / live.length) }, () => live).flat() : [];
  const tape = [...run, ...run];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {tape.length > 0 && (
        <div className="card rise d1" style={{ overflow: "hidden", padding: "10px 0", borderRadius: 14 }}>
          <div className="marquee">
            {tape.map((w, i) => (
              <button key={i} type="button" className="mono" onClick={() => setSel({ symbol: w.symbol, kind: w.kind })} style={{ border: 0, background: "transparent", fontSize: 12, display: "inline-flex", gap: 8, whiteSpace: "nowrap", marginRight: 34 }}>
                <b style={{ fontWeight: 600 }}>{w.label}</b>
                <span>{fmt(w.quote!.price, w.quote!.currency)}</span>
                <span style={{ color: w.quote!.changePct >= 0 ? "#F4F4F5" : "#FF5A66" }}>{pctTxt(w.quote!.changePct)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="g3 cols" style={{ ["--cols" as string]: "290px minmax(0,1fr) 330px" }}>
        {/* watchlist */}
        <section className="card rise d2" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 6, alignSelf: "start" }}>
          <form
            className="row"
            style={{ gap: 6, marginBottom: 6 }}
            onSubmit={(e) => {
              e.preventDefault();
              void add(find);
            }}
          >
            <span style={{ position: "relative", flexGrow: 1 }}>
              <Icon d={P.search} size={14} color="#71717A" style={{ position: "absolute", left: 12, top: 15 }} />
              <input aria-label="Add a ticker" className="field" value={find} onChange={(e) => setFind(e.target.value)} placeholder="AAPL, BTC, VUSA.L…" style={{ paddingLeft: 34, height: 44 }} />
            </span>
            <button type="submit" className="btn iconbtn" aria-label="Add to watchlist" disabled={adding} style={{ width: 44, height: 44 }}>
              <Icon d={adding ? P.refresh : P.plus} size={15} />
            </button>
          </form>
          {data.watch.length === 0 && (
            <>
              <div className="muted" style={{ fontSize: 13, padding: "4px 6px 8px" }}>Your watchlist is empty. Try one of these:</div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {QUICK.map(([s, n]) => (
                  <button key={s} type="button" className="chip" title={n} onClick={() => void add(s)}>{s}</button>
                ))}
              </div>
            </>
          )}
          {data.watch.map((w) => {
            const on = sel?.symbol === w.symbol && sel.kind === w.kind;
            return (
              <div key={`${w.kind}:${w.symbol}`} className="row" style={{ gap: 4, borderRadius: 14, border: `1px solid ${on ? "rgba(255,43,58,0.45)" : "transparent"}`, background: on ? "rgba(255,43,58,0.07)" : undefined, transition: "all .3s" }}>
                <button type="button" data-sfx="tab" className="listbtn" style={{ flexGrow: 1, minWidth: 0, minHeight: 58, gap: 10 }} onClick={() => setSel({ symbol: w.symbol, kind: w.kind })}>
                  <span style={{ minWidth: 0, flexGrow: 1 }}>
                    <span className="row" style={{ gap: 6, fontSize: 13, fontWeight: 600 }}>
                      {w.label}
                      {w.alert && <Icon d={P.alert} size={11} color={w.alert.firedAt ? "#FF2B3A" : "#71717A"} />}
                    </span>
                    <span className="muted" style={{ display: "block", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w.error ? w.error : w.quote?.name}</span>
                  </span>
                  {w.quote && <Spark points={w.quote.history} up={w.quote.changePct >= 0} />}
                  <span style={{ textAlign: "right" }}>
                    <span className="mono" style={{ display: "block", fontSize: 12 }}>{w.quote ? fmt(w.quote.price, w.quote.currency) : "—"}</span>
                    {w.quote && <span className="mono" style={{ display: "block", fontSize: 10, color: w.quote.changePct >= 0 ? "#A1A1AA" : "#FF5A66" }}>{pctTxt(w.quote.changePct)}</span>}
                  </span>
                </button>
                <button type="button" className="chip" aria-label={`Remove ${w.label}`} style={{ height: 24, padding: "0 7px", opacity: on ? 1 : 0.4 }} onClick={() => void remove(w)}>
                  <Icon d={P.x} size={10} />
                </button>
              </div>
            );
          })}
          <p className="muted" style={{ margin: "8px 6px 0", fontSize: 11, lineHeight: 1.5 }}>Prices from Yahoo Finance and CoinGecko public feeds; they may be delayed. Refreshes every minute.</p>
        </section>

        {/* chart */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div className="card rise d3" style={{ padding: "18px 20px" }}>
            {!sel ? (
              <div style={{ padding: "60px 10px", textAlign: "center" }}>
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Pick something to watch</h2>
                <p className="muted" style={{ fontSize: 14 }}>Add a stock, fund or coin on the left — Quant explains the chart in plain English.</p>
              </div>
            ) : curErr ? (
              <div style={{ padding: 40, textAlign: "center", color: "#FF5A66" }}>{curErr}</div>
            ) : !cur ? (
              <div className="muted" style={{ padding: 40 }}>Loading chart…</div>
            ) : (
              <div key={cur.symbol + span} className="tx-rise">
                <div className="row" style={{ flexWrap: "wrap", gap: 12, marginBottom: 10 }}>
                  <div style={{ flexGrow: 1 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="disp" style={{ fontSize: 15 }}>{cur.label}</span>
                      <span className="muted" style={{ fontSize: 13 }}>· {cur.name}</span>
                      {cur.stale && <span className="mono" style={{ fontSize: 10, color: "#FF5A66" }}>STALE</span>}
                    </div>
                    <div className="row" style={{ alignItems: "baseline", gap: 12 }}>
                      <span className="disp" style={{ fontSize: 34, fontWeight: 300 }}>{fmt(cur.price, cur.currency)}</span>
                      <span className="mono" style={{ fontSize: 13, color: cur.changePct >= 0 ? "#F4F4F5" : "#FF5A66" }}>{pctTxt(cur.changePct)} today</span>
                    </div>
                  </div>
                  <Seg label="Chart range" value={span} width={290} options={[["1d", "1D"], ["1w", "1W"], ["1m", "1M"], ["6m", "6M"], ["1y", "1Y"]]} onChange={setSpan} />
                </div>
                <Chart points={cur.history} up={cur.stats.changePct >= 0} currency={cur.currency} span={span} />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))", gap: 10, marginTop: 14 }}>
                  {([
                    ["Range change", pctTxt(cur.stats.changePct)],
                    ["High", fmt(cur.stats.high, cur.currency)],
                    ["Low", fmt(cur.stats.low, cur.currency)],
                    ["Volatility", `${cur.stats.volatilityPct}% / bar`],
                    ["Max drawdown", `${cur.stats.maxDrawdownPct}%`],
                  ] as const).map(([k, v]) => (
                    <div key={k} style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      <div className="eyebrow" style={{ fontSize: 9 }}>{k}</div>
                      <div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{v}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {sel && cur && (
            <div className="card hot rise d4" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="row">
                <Sigil id="quant" size={40} />
                <div style={{ flexGrow: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>Quant’s read · {cur.label}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Plain English, from the numbers above. Never a tip.</div>
                </div>
                <button type="button" className="btn btn-red" data-sfx="none" disabled={reading || !state.engines.claudeKeys} title={state.engines.claudeKeys ? "" : "Add a Claude key first"} onClick={() => askQuant()}>
                  <Icon d={P.wand} size={14} /> {reading ? "Reading…" : "Explain this chart"}
                </button>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
                {["Is this risky for a beginner?", "Why might it have moved like this?", "How does it compare to an index fund?"].map((q) => (
                  <button key={q} type="button" className="chip" disabled={reading || !state.engines.claudeKeys} onClick={() => askQuant(q)}>{q}</button>
                ))}
              </div>
              {(read || reading) && (
                <div className="bubble-ai tx-rise" style={{ fontSize: 13 }}>
                  <Md text={read} />
                  {reading && <span className="dots3"><span /><span /><span /></span>}
                </div>
              )}
            </div>
          )}
        </section>

        {/* paper account + alerts */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card rise d4" style={{ padding: 18 }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Paper account</h2>
              <span className="stat" style={{ height: 24, fontSize: 10 }}><i />PRACTICE MONEY</span>
            </div>
            <div className="disp" style={{ fontSize: 30, fontWeight: 300 }}>{fmt(total, "USD", 2)}</div>
            <div className="mono" style={{ fontSize: 12, color: pnl >= 0 ? "#F4F4F5" : "#FF5A66" }}>
              {pnl >= 0 ? "▲" : "▼"} {fmt(Math.abs(pnl), "USD", 2)} since start
            </div>
            <div style={{ display: "flex", height: 8, borderRadius: 6, overflow: "hidden", margin: "14px 0 8px", background: "rgba(255,255,255,0.05)" }}>
              {paper.positions.map((p, i) => (
                <span key={p.symbol} title={p.label} style={{ width: `${((p.value ?? p.cost) / total) * 100}%`, background: i % 2 ? "#F4F4F5" : "#FF2B3A", opacity: 1 - i * 0.12, transformOrigin: "left", animation: "growx .9s cubic-bezier(.2,.8,.2,1) both" }} />
              ))}
            </div>
            <div className="row mono muted" style={{ fontSize: 10, justifyContent: "space-between" }}>
              <span>INVESTED {fmt(invested, "USD", 0)}</span>
              <span>CASH {fmt(paper.cash, "USD", 0)}</span>
            </div>
            {paper.positions.map((p) => {
              const gain = p.value === null ? null : p.value - p.cost;
              return (
                <div key={p.symbol} className="row" style={{ padding: "9px 0", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 13, marginTop: 6 }}>
                  <button type="button" style={{ border: 0, background: "transparent", padding: 0, fontWeight: 600, flexGrow: 1, textAlign: "left" }} onClick={() => setSel({ symbol: p.symbol, kind: p.kind })}>
                    {p.label} <span className="muted mono" style={{ fontWeight: 400, fontSize: 11 }}>× {+p.qty.toFixed(6)}</span>
                  </button>
                  <span className="mono" style={{ fontSize: 12 }}>{fmt(p.value, "USD", 2)}</span>
                  <span className="mono" style={{ fontSize: 11, width: 76, textAlign: "right", color: gain === null || gain >= 0 ? "#A1A1AA" : "#FF5A66" }}>{gain === null ? "" : `${gain >= 0 ? "+" : "−"}${fmt(Math.abs(gain), "USD", 2)}`}</span>
                </div>
              );
            })}
            {sel && cur && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Practice trade · {cur.label} @ {fmt(cur.price, cur.currency)}</div>
                <div className="row" style={{ gap: 6 }}>
                  <input aria-label="Quantity" className="field mono" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 80, height: 40, flexShrink: 0 }} />
                  <button type="button" className="btn btn-white" style={{ flexGrow: 1, height: 40 }} disabled={cur.currency !== "USD"} onClick={() => void trade("buy")}>Buy</button>
                  <button type="button" className="btn" style={{ flexGrow: 1, height: 40 }} disabled={cur.currency !== "USD"} onClick={() => void trade("sell")}>Sell</button>
                </div>
                <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                  {cur.currency === "USD" ? `≈ ${fmt(Number(qty) * cur.price || 0, "USD", 2)} · no fees, fills at the latest price` : `Paper account is in USD; ${cur.label} trades in ${cur.currency}.`}
                </div>
              </div>
            )}
            {paper.trades.length > 0 && (
              <button type="button" className="chip" style={{ marginTop: 12 }} onClick={async () => confirm("Reset the paper account to $10,000?") && (await api("/api/markets/paper/reset", { body: {} }), void load())}>
                <Icon d={P.refresh} size={12} /> Reset account
              </button>
            )}
          </div>

          {sel && cur && (
            <div className="card rise d5" style={{ padding: 18 }}>
              <h2 className="disp" style={{ margin: "0 0 4px", fontSize: 14, fontWeight: 400 }}>Price alert · {cur.label}</h2>
              <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>Checked every 5 minutes while GUG-cli runs. Fires once into your inbox.</p>
              <div className="row" style={{ gap: 6 }}>
                <input aria-label="Alert above" className="field mono" inputMode="decimal" placeholder="above" value={alert.above} onChange={(e) => setAlertDraft({ ...alert, above: e.target.value })} style={{ height: 40, flex: "1 1 0", minWidth: 0 }} />
                <input aria-label="Alert below" className="field mono" inputMode="decimal" placeholder="below" value={alert.below} onChange={(e) => setAlertDraft({ ...alert, below: e.target.value })} style={{ height: 40, flex: "1 1 0", minWidth: 0 }} />
                <button type="button" className="btn" style={{ height: 40 }} onClick={saveAlert}>Set</button>
              </div>
            </div>
          )}

          {paper.trades.length > 0 && (
            <div className="card rise d6" style={{ padding: 18 }}>
              <h2 className="disp" style={{ margin: "0 0 8px", fontSize: 14, fontWeight: 400 }}>Practice trades</h2>
              {paper.trades.slice(0, 6).map((t) => (
                <div key={t.id} className="row mono" style={{ fontSize: 11, padding: "4px 0" }}>
                  <span style={{ color: t.side === "buy" ? "#F4F4F5" : "#FF5A66", width: 34 }}>{t.side.toUpperCase()}</span>
                  <span style={{ flexGrow: 1 }}>{+t.qty.toFixed(6)} {t.label}</span>
                  <span className="muted">@ {fmt(t.price, "USD")}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Spark({ points, up }: { points: [number, number][]; up: boolean }) {
  const px = points.map((p) => p[1]);
  if (px.length < 2) return null;
  const lo = Math.min(...px);
  const hi = Math.max(...px);
  const d = px.map((v, i) => `${i ? "L" : "M"}${((i / (px.length - 1)) * 54).toFixed(1)} ${(20 - ((v - lo) / (hi - lo || 1)) * 18).toFixed(1)}`).join(" ");
  return (
    <svg width="54" height="22" viewBox="0 0 54 22" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={d} fill="none" stroke={up ? "#F4F4F5" : "#FF2B3A"} strokeWidth="1.3" />
    </svg>
  );
}

const CW = 640;
const CH = 240;
function Chart({ points, up, currency, span }: { points: [number, number][]; up: boolean; currency: string; span: Span }) {
  const [hover, setHover] = useState<number | null>(null);
  const px = points.map((p) => p[1]);
  if (px.length < 2) return <div className="muted" style={{ padding: 40 }}>Not enough data for this range yet.</div>;
  const lo = Math.min(...px);
  const hi = Math.max(...px);
  const x = (i: number) => (i / (px.length - 1)) * CW;
  const y = (v: number) => 12 + (CH - 24) * (1 - (v - lo) / (hi - lo || 1));
  const d = px.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const color = up ? "#F4F4F5" : "#FF2B3A";
  const when = (t: number) => new Date(t).toLocaleString(undefined, span === "1d" || span === "1w" ? { weekday: "short", hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short", year: span === "1y" ? "2-digit" : undefined });
  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${CW} ${CH}`}
        width="100%"
        role="img"
        aria-label="Price chart"
        style={{ display: "block", overflow: "visible" }}
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(px.length - 1, Math.round(((e.clientX - r.left) / r.width) * (px.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="mkfill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={up ? "#FFFFFF" : "#FF2B3A"} stopOpacity=".22" />
            <stop offset="1" stopColor={up ? "#FFFFFF" : "#FF2B3A"} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={CW} y1={CH * f} y2={CH * f} stroke="rgba(255,255,255,.05)" />)}
        <line x1="0" x2={CW} y1={y(px[0])} y2={y(px[0])} stroke="rgba(255,255,255,.14)" strokeDasharray="3 5" />
        <path d={`${d} L${CW} ${CH} L0 ${CH} Z`} fill="url(#mkfill)" className="fade" />
        <path d={d} fill="none" stroke={color} strokeWidth="2" className="draw" pathLength={1000} style={{ filter: `drop-shadow(0 0 6px ${up ? "rgba(255,255,255,.35)" : "rgba(255,43,58,.7)"})` }} />
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1="0" y2={CH} stroke="rgba(255,255,255,.25)" />
            <circle cx={x(hover)} cy={y(px[hover])} r="4.5" fill="#FF2B3A" stroke="#030303" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="card pop mono" style={{ position: "absolute", top: 0, [hover > px.length / 2 ? "left" : "right"]: 8, padding: "8px 11px", borderRadius: 10, fontSize: 11, pointerEvents: "none" }}>
          <div className="muted">{when(points[hover][0])}</div>
          <div style={{ fontSize: 13 }}>{fmt(px[hover], currency)}</div>
        </div>
      )}
    </div>
  );
}
