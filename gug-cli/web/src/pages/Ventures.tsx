import { useEffect, useMemo, useRef, useState } from "react";
import { fromColumns, fromShopify, isShopify, parseCsv, type ImportEntry } from "../csv";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { Md } from "../Md";
import { play } from "../sfx";
import { BRAND, Brand, Icon, P, Seg, Sigil, Switch } from "../ui";

type Range = "7d" | "30d" | "90d" | "12m";
type Kind = "shopify" | "roblox" | "gumroad" | "etsy" | "youtube" | "other";
interface Totals { revenue: number; costs: number; refunds: number; profit: number; orders: number }
interface StreamRow { id: string; name: string; kind: Kind; robux: boolean; rate: number; sample?: boolean; universeId?: number; totals: Totals; margin: number; change: number | null; rawSales: number }
interface Entry { id: string; streamId: string; date: string; type: "sale" | "cost" | "refund"; amount: number; orders: number; note: string; sample?: boolean }
interface Kpi { value: number; change: number | null }
interface Summary {
  currency: "GBP" | "USD" | "EUR";
  range: Range;
  from: string;
  to: string;
  kpis: { revenue: Kpi; profit: Kpi; orders: Kpi; margin: Kpi };
  series: (Totals & { label: string })[];
  streams: StreamRow[];
  recent: Entry[];
  hasSample: boolean;
}

const KINDS: [Kind, string][] = [["shopify", "Shopify / store"], ["roblox", "Roblox game"], ["gumroad", "Gumroad / digital"], ["etsy", "Etsy"], ["youtube", "YouTube"], ["other", "Other"]];
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function Ventures() {
  const { toast, state } = useApp();
  const [range, setRange] = useState<Range>(() => (localStorage.getItem("gug-vrange") as Range) || "30d");
  const [s, setS] = useState<Summary | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [review, setReview] = useState("");
  const [question, setQuestion] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const abortRef = useRef<() => void>(() => {});

  const load = async (r = range) => setS(await api<Summary>(`/api/ventures?range=${r}`));
  useEffect(() => {
    void load(range);
    try {
      localStorage.setItem("gug-vrange", range);
    } catch {
      /* private mode */
    }
  }, [range]);
  useEffect(() => () => abortRef.current(), []);

  const money = useMemo(() => {
    const f = new Intl.NumberFormat(undefined, { style: "currency", currency: s?.currency ?? "GBP", maximumFractionDigits: 0 });
    const f2 = new Intl.NumberFormat(undefined, { style: "currency", currency: s?.currency ?? "GBP", maximumFractionDigits: 2 });
    return (n: number, exact = false) => (exact ? f2 : f).format(n);
  }, [s?.currency]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await load();
      if (ok) toast(ok);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const ask = () => {
    if (!s) return;
    play("send");
    setReview("");
    setReviewing(true);
    abortRef.current = stream("/api/ventures/review", { range, question }, (ev: GugEvent) => {
      if (ev.type === "text") setReview((r) => r + ev.text);
      if (ev.type === "error") setReview((r) => `${r}\n\n**Couldn’t finish:** ${ev.message}`);
    }, () => setReviewing(false));
  };

  if (!s) return <div className="muted">Loading…</div>;
  const empty = !s.streams.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="row rise d1" style={{ flexWrap: "wrap", gap: 10 }}>
        <Seg label="Range" value={range} width={300} options={[["7d", "7D"], ["30d", "30D"], ["90d", "90D"], ["12m", "12M"]]} onChange={setRange} />
        <select aria-label="Home currency" className="field" value={s.currency} style={{ width: 96, height: 44 }} onChange={(e) => void act(() => api("/api/ventures/currency", { method: "PUT", body: { currency: e.target.value } }))}>
          {["GBP", "USD", "EUR"].map((c) => <option key={c}>{c}</option>)}
        </select>
        <span className="mono muted" style={{ fontSize: 11 }}>{s.from} → {s.to}</span>
        <span style={{ flexGrow: 1 }} />
        {s.hasSample ? (
          <button type="button" className="chip" onClick={() => void act(() => api("/api/ventures/sample", { method: "DELETE" }), "Sample data cleared.")}>
            <Icon d={P.x} size={12} /> Clear sample data
          </button>
        ) : (
          <button type="button" className="chip" onClick={() => void act(() => api("/api/ventures/sample", { body: {} }), "Sample data loaded — it’s labelled so you can clear it later.")}>
            <Icon d={P.wand} size={12} /> Load sample data
          </button>
        )}
        {s.streams.length > 0 && (
          <button type="button" className="chip" onClick={() => setImporting(!importing)}>
            <Icon d={P.down} size={12} /> Import CSV
          </button>
        )}
        <button type="button" className="btn btn-white" onClick={() => setAdding(true)}>
          <Icon d={P.plus} size={14} /> Add stream
        </button>
      </div>
      {importing && s.streams.length > 0 && <ImportCsv streams={s.streams} currency={s.currency} onClose={() => setImporting(false)} onDone={() => void load()} />}

      {adding && <AddStream onClose={() => setAdding(false)} onSave={(body) => act(() => api("/api/ventures/streams", { body }), "Stream added.").then(() => setAdding(false))} />}

      {empty && !adding ? (
        <section className="card rise d2 stage" style={{ padding: 40, minHeight: 360, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
          <div className="floor" style={{ height: 200, opacity: 0.5 }} />
          <span className="stat" style={{ position: "relative", alignSelf: "flex-start" }}><i />Private · stays on this computer</span>
          <h2 className="disp" style={{ position: "relative", margin: 0, fontSize: 30, fontWeight: 300 }}>Every income stream, one screen<span style={{ color: "#FF2B3A" }}>.</span></h2>
          <p className="muted" style={{ position: "relative", margin: 0, maxWidth: 560, fontSize: 14, lineHeight: 1.6 }}>
            Add a stream for each store, game or product, log sales and costs, and Ledger will tell you what’s working. Robux are converted at the DevEx rate you set.
          </p>
          <div className="row" style={{ position: "relative", gap: 10 }}>
            <button type="button" className="btn btn-red" onClick={() => setAdding(true)}>Add your first stream</button>
            <button type="button" className="btn" onClick={() => void act(() => api("/api/ventures/sample", { body: {} }), "Sample data loaded.")}>Try with sample data</button>
          </div>
        </section>
      ) : (
        !empty && (
          <>
            <div className="k4">
              <KpiCard i={0} label="Revenue" value={money(s.kpis.revenue.value)} change={s.kpis.revenue.change} />
              <KpiCard i={1} label="Net profit" value={money(s.kpis.profit.value)} change={s.kpis.profit.change} hot />
              <KpiCard i={2} label="Orders" value={s.kpis.orders.value.toLocaleString()} change={s.kpis.orders.change} />
              <KpiCard i={3} label="Avg margin" value={`${s.kpis.margin.value}%`} change={s.kpis.margin.change} unit="pts" />
            </div>

            <div className="g2r">
              <section className="card rise d3" style={{ padding: "18px 20px 14px" }}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Revenue &amp; profit</h2>
                  <Legend color="#F4F4F5" label="Revenue" />
                  <Legend color="#FF2B3A" label="Profit" />
                </div>
                <AreaChart key={range + s.currency} points={s.series} money={money} />
              </section>
              <section className="card rise d4" style={{ padding: "18px 20px" }}>
                <div className="row" style={{ marginBottom: 14 }}>
                  <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Profit by {range === "12m" ? "month" : range === "90d" ? "week" : "day"}</h2>
                  <span className="mono muted" style={{ fontSize: 10 }}>LAST {Math.min(14, s.series.length)}</span>
                </div>
                <Bars key={range} points={s.series.slice(-14)} money={money} range={range} />
              </section>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
              {s.streams.map((x, i) => (
                <section key={x.id} className="card tilt rise" style={{ padding: 18, animationDelay: `${0.3 + i * 0.06}s` }}>
                  <div className="row" style={{ marginBottom: 12 }}>
                    <Brand name={BRAND[x.kind] ? x.kind : "other"} size={38} variant={i === 0 ? "red" : "tint"} />
                    <div style={{ flexGrow: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</div>
                      <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".1em" }}>{KINDS.find(([k]) => k === x.kind)?.[1].toUpperCase()}{x.sample ? " · SAMPLE" : ""}</div>
                    </div>
                    <button type="button" className="chip" aria-label={`Remove ${x.name}`} style={{ height: 26, padding: "0 8px" }} onClick={() => confirm(`Remove “${x.name}” and all its entries?`) && void act(() => api(`/api/ventures/streams/${x.id}`, { method: "DELETE" }), "Stream removed.")}>
                      <Icon d={P.x} size={11} />
                    </button>
                  </div>
                  <div className="row" style={{ alignItems: "flex-end" }}>
                    <div style={{ flexGrow: 1 }}>
                      <div className="disp" style={{ fontSize: 24, fontWeight: 300 }}>{money(x.totals.profit)}</div>
                      <div className="muted" style={{ fontSize: 11 }}>
                        profit · {x.margin}% margin{x.robux ? ` · ${Math.round(x.rawSales).toLocaleString()} R$` : ""}
                      </div>
                    </div>
                    <Change v={x.change} />
                  </div>
                  {x.kind === "roblox" && <RobloxLive stream={x} onChange={() => void load()} />}
                </section>
              ))}
            </div>

            <div className="g2r">
              <section className="card rise d5" style={{ padding: 18 }}>
                <AddEntry streams={s.streams} currency={s.currency} onSave={(body) => act(() => api("/api/ventures/entries", { body }), "Logged.")} />
                <h2 className="disp" style={{ margin: "18px 0 6px", fontSize: 14, fontWeight: 400 }}>Recent entries</h2>
                {s.recent.map((e) => {
                  const st = s.streams.find((x) => x.id === e.streamId);
                  const value = e.amount * (st?.robux ? st.rate : 1);
                  return (
                    <div key={e.id} className="row" style={{ padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.06)", fontSize: 13 }}>
                      <span className="mono muted" style={{ fontSize: 11, width: 84 }}>{e.date}</span>
                      <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <b style={{ fontWeight: 600 }}>{st?.name}</b> <span className="muted">· {e.note || e.type}</span>
                      </span>
                      <span className="mono" style={{ fontSize: 10, color: e.type === "sale" ? "#A1A1AA" : "#FF5A66" }}>{e.type.toUpperCase()}</span>
                      <span className="mono" style={{ width: 100, textAlign: "right", color: e.type === "sale" ? "#F4F4F5" : "#FF5A66" }}>
                        {e.type === "sale" ? "+" : "−"}
                        {st?.robux ? `${Math.round(e.amount).toLocaleString()} R$` : money(value, true)}
                      </span>
                      <button type="button" className="chip" aria-label="Delete entry" style={{ height: 24, padding: "0 7px" }} onClick={() => void act(() => api(`/api/ventures/entries/${e.id}`, { method: "DELETE" }))}>
                        <Icon d={P.x} size={10} />
                      </button>
                    </div>
                  );
                })}
              </section>

              <section className="card hot rise d6" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12, alignSelf: "start" }}>
                <div className="row">
                  <Sigil id="ledger" size={40} />
                  <div style={{ flexGrow: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Ledger’s review</div>
                    <div className="muted" style={{ fontSize: 12 }}>Reads this {range.toUpperCase()} view, suggests next moves</div>
                  </div>
                </div>
                <textarea aria-label="Question for Ledger" className="field" rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Optional: “Should I raise the lamp price?”" />
                <button type="button" className="btn btn-red" data-sfx="none" disabled={reviewing || !state.engines.claudeKeys} title={state.engines.claudeKeys ? "" : "Add a Claude key first"} onClick={ask}>
                  <Icon d={P.wand} size={14} /> {reviewing ? "Ledger is reading…" : "Review my numbers"}
                </button>
                {(review || reviewing) && (
                  <div className="bubble-ai tx-rise" style={{ fontSize: 13 }}>
                    <Md text={review} />
                    {reviewing && <span className="dots3"><span /><span /><span /></span>}
                  </div>
                )}
                <p className="muted" style={{ margin: 0, fontSize: 11 }}>Only totals for this range are sent to Claude — never your keys or other data. Not financial advice.</p>
              </section>
            </div>
          </>
        )
      )}
    </div>
  );
}

function Change({ v, unit = "%" }: { v: number | null; unit?: string }) {
  if (v === null) return <span className="mono muted" style={{ fontSize: 11 }}>new</span>;
  const up = v >= 0;
  return (
    <span className="mono" style={{ fontSize: 11, color: up ? "#F4F4F5" : "#FF5A66" }}>
      {up ? "▲" : "▼"} {Math.abs(v)}
      {unit === "%" ? "%" : ` ${unit}`}
    </span>
  );
}

function KpiCard({ label, value, change, hot, i, unit }: { label: string; value: string; change: number | null; hot?: boolean; i: number; unit?: string }) {
  return (
    <section className={`card tilt rise ${hot ? "hot" : ""}`} style={{ padding: "16px 18px", animationDelay: `${0.15 + i * 0.07}s` }}>
      <div className="row">
        <span className="eyebrow" style={{ fontSize: 10, flexGrow: 1 }}>{label}</span>
        <Change v={change} unit={unit} />
      </div>
      <div className="disp" style={{ fontSize: 30, fontWeight: 300, marginTop: 8, color: hot ? "#FF2B3A" : undefined }}>{value}</div>
      <div className="muted" style={{ fontSize: 11 }}>vs previous period</div>
    </section>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="row mono muted" style={{ fontSize: 10, gap: 6, marginLeft: 12 }}>
      <i style={{ width: 10, height: 2, background: color, boxShadow: `0 0 6px ${color}` }} />
      {label.toUpperCase()}
    </span>
  );
}

const W = 640;
const H = 220;
function path(vals: number[], lo: number, hi: number) {
  const span = hi - lo || 1;
  return vals.map((v, i) => `${i ? "L" : "M"}${((i / Math.max(1, vals.length - 1)) * W).toFixed(1)} ${(14 + (H - 28) * (1 - (v - lo) / span)).toFixed(1)}`).join(" ");
}

function AreaChart({ points, money }: { points: (Totals & { label: string })[]; money: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const rev = points.map((p) => p.revenue);
  const prof = points.map((p) => p.profit);
  const lo = Math.min(0, ...prof);
  const hi = Math.max(1, ...rev);
  const zeroY = 14 + (H - 28) * (1 - (0 - lo) / (hi - lo || 1));
  const pr = path(prof, lo, hi);
  const h = hover === null ? null : points[hover];
  return (
    <div style={{ position: "relative" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ display: "block", overflow: "visible" }}
        role="img"
        aria-label="Revenue and profit over time"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(((e.clientX - r.left) / r.width) * (points.length - 1)))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="vprof" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#FF2B3A" stopOpacity=".42" />
            <stop offset="1" stopColor="#FF2B3A" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,.05)" />)}
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,.12)" strokeDasharray="3 5" />
        <path d={`${pr} L${W} ${zeroY} L0 ${zeroY} Z`} fill="url(#vprof)" className="fade" />
        <path d={path(rev, lo, hi)} fill="none" stroke="#F4F4F5" strokeWidth="1.6" className="draw" pathLength={1000} />
        <path d={pr} fill="none" stroke="#FF2B3A" strokeWidth="2.2" className="draw" pathLength={1000} style={{ filter: "drop-shadow(0 0 6px rgba(255,43,58,.7))" }} />
        {h && hover !== null && (
          <g>
            <line x1={(hover / Math.max(1, points.length - 1)) * W} x2={(hover / Math.max(1, points.length - 1)) * W} y1="0" y2={H} stroke="rgba(255,255,255,.25)" />
            <circle cx={(hover / Math.max(1, points.length - 1)) * W} cy={14 + (H - 28) * (1 - (h.profit - lo) / (hi - lo || 1))} r="4.5" fill="#FF2B3A" stroke="#030303" strokeWidth="2" />
          </g>
        )}
      </svg>
      <div className="row mono muted" style={{ fontSize: 10, justifyContent: "space-between", marginTop: 6 }}>
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
      {h && (
        <div className="card pop" style={{ position: "absolute", top: 0, left: hover! > points.length / 2 ? 8 : "auto", right: hover! > points.length / 2 ? "auto" : 8, padding: "10px 12px", borderRadius: 12, fontSize: 12, pointerEvents: "none" }}>
          <div className="mono muted" style={{ fontSize: 10 }}>{h.label}</div>
          <div>Revenue <b>{money(h.revenue)}</b></div>
          <div style={{ color: "#FF5A66" }}>Profit <b>{money(h.profit)}</b></div>
          <div className="muted">{h.orders} orders</div>
        </div>
      )}
    </div>
  );
}

function Bars({ points, money, range }: { points: (Totals & { label: string })[]; money: (n: number) => string; range: Range }) {
  const hi = Math.max(1, ...points.map((p) => Math.abs(p.profit)));
  const short = (l: string) => (range === "12m" ? new Date(`${l}-01`).toLocaleString(undefined, { month: "short" }) : l.slice(8));
  return (
    <div className="row" style={{ alignItems: "flex-end", height: 210, gap: 8, paddingRight: 10 }}>
      {points.map((p, i) => (
        <div key={p.label} title={`${p.label}: ${money(p.profit)}`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, height: "100%", justifyContent: "flex-end" }}>
          <div className={`bar3d grow ${p.profit < 0 ? "w" : ""}`} style={{ height: `${Math.max(2, (Math.abs(p.profit) / hi) * 170)}px`, animationDelay: `${0.2 + i * 0.04}s`, opacity: i === points.length - 1 ? 1 : 0.78 }} />
          <span className="mono muted" style={{ fontSize: 9 }}>{short(p.label)}</span>
        </div>
      ))}
    </div>
  );
}

function AddStream({ onClose, onSave }: { onClose: () => void; onSave: (b: object) => Promise<unknown> }) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("shopify");
  const [rate, setRate] = useState("0.0035");
  return (
    <section className="card hot tx-drop" style={{ padding: 20, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Name</span>
        <input className="field" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Lumen Desk Co." />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 1 200px" }}>
        <span className="eyebrow" style={{ fontSize: 10 }}>Type</span>
        <select className="field" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
          {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </label>
      {kind === "roblox" && (
        <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "0 1 170px" }}>
          <span className="eyebrow" style={{ fontSize: 10 }}>Value per R$</span>
          <input className="field mono" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </label>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-red" onClick={() => void onSave({ name, kind, rate: Number(rate) })}>Add stream</button>
      </div>
      {kind === "roblox" && <p className="muted" style={{ margin: 0, fontSize: 12, flexBasis: "100%" }}>Log Roblox earnings in Robux (after Roblox’s cut). They’re converted with this rate — DevEx is about 0.0035 USD per R$.</p>}
    </section>
  );
}

function AddEntry({ streams, currency, onSave }: { streams: StreamRow[]; currency: string; onSave: (b: object) => Promise<unknown> }) {
  const [streamId, setStreamId] = useState(streams[0]?.id ?? "");
  const [type, setType] = useState<"sale" | "cost" | "refund">("sale");
  const [amount, setAmount] = useState("");
  const [orders, setOrders] = useState("1");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(today);
  const st = streams.find((x) => x.id === streamId) ?? streams[0];
  const submit = async () => {
    await onSave({ streamId: st?.id, type, amount: Number(amount), orders: Number(orders), note, date });
    setAmount("");
    setNote("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 10 }}
    >
      <div className="row">
        <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Log money in or out</h2>
        <Seg label="Entry type" value={type} width={250} options={[["sale", "Sale"], ["cost", "Cost"], ["refund", "Refund"]]} onChange={setType} />
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <select aria-label="Stream" className="field" value={st?.id} onChange={(e) => setStreamId(e.target.value)} style={{ flex: "1 1 150px" }}>
          {streams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <input aria-label={`Amount in ${st?.robux ? "Robux" : currency}`} className="field mono" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={st?.robux ? "R$" : currency} style={{ flex: "0 1 110px" }} />
        {type === "sale" && <input aria-label="Orders" className="field mono" inputMode="numeric" value={orders} onChange={(e) => setOrders(e.target.value)} style={{ flex: "0 1 70px" }} title="Orders" />}
        <input aria-label="Date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} style={{ flex: "0 1 150px" }} />
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input aria-label="Note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === "cost" ? "e.g. TikTok ads" : "e.g. Ambient desk lamp"} style={{ flexGrow: 1 }} />
        <button type="submit" className="btn btn-red" disabled={!amount}>Log</button>
      </div>
    </form>
  );
}

function ImportCsv({ streams, currency, onClose, onDone }: { streams: StreamRow[]; currency: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [streamId, setStreamId] = useState(streams.find((x) => x.kind === "shopify")?.id ?? streams[0].id);
  const [cols, setCols] = useState({ date: 0, amount: 1, note: -1, dayFirst: true, skipHeader: true });
  const [busy, setBusy] = useState(false);
  const shopify = !!rows && isShopify(rows[0]);
  const entries: ImportEntry[] = !rows ? [] : shopify ? fromShopify(rows) : fromColumns(rows, cols);
  const total = entries.reduce((a, e) => a + (e.type === "sale" ? e.amount : -e.amount), 0);
  const header = rows?.[0] ?? [];

  const pick = async (f: File) => {
    const r = parseCsv(await f.text());
    if (!r.length) return toast("That file looks empty.", "err");
    setRows(r);
    setFileName(f.name);
    // Guess columns for generic sheets.
    const h = r[0].map((x) => x.toLowerCase());
    const find = (re: RegExp) => h.findIndex((x) => re.test(x));
    setCols((c) => ({ ...c, date: Math.max(0, find(/date|created|paid|when|day/)), amount: Math.max(0, find(/amount|total|price|net|£|\$|value/)), note: find(/note|desc|item|product|what|name/) }));
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api<{ added: number; skipped: number }>("/api/ventures/import", { body: { streamId, entries } });
      play("success");
      toast(`Imported ${r.added} entries${r.skipped ? ` · ${r.skipped} skipped (already there or invalid)` : ""}.`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };
  const sel = (label: string, key: "date" | "amount" | "note", allowNone = false) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 150px" }}>
      <span className="eyebrow" style={{ fontSize: 10 }}>{label}</span>
      <select className="field" value={cols[key]} onChange={(e) => setCols({ ...cols, [key]: Number(e.target.value) })}>
        {allowNone && <option value={-1}>None</option>}
        {header.map((h, i) => <option key={i} value={i}>{cols.skipHeader ? h || `Column ${i + 1}` : `Column ${i + 1} (${h})`}</option>)}
      </select>
    </label>
  );
  return (
    <section className="card hot tx-drop" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="row">
        <div style={{ flexGrow: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Import from a spreadsheet</div>
          <div className="muted" style={{ fontSize: 12 }}>A Shopify “Export orders” CSV is read automatically. Anything else: pick the date and amount columns. Negative amounts become costs.</div>
        </div>
        <button type="button" className="chip" aria-label="Close import" onClick={onClose}><Icon d={P.x} size={12} /></button>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
        <label className="btn" style={{ cursor: "pointer" }}>
          <Icon d={P.file} size={14} /> {fileName || "Choose a .csv file"}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
        </label>
        <select aria-label="Import into stream" className="field" value={streamId} onChange={(e) => setStreamId(e.target.value)} style={{ width: 220 }}>
          {streams.map((x) => <option key={x.id} value={x.id}>Into: {x.name}</option>)}
        </select>
        {rows && <span className="stat"><i className={shopify ? "" : "w"} />{shopify ? "Shopify orders export" : `${rows.length} rows`}</span>}
      </div>
      {rows && !shopify && (
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          {sel("Date column", "date")}
          {sel("Amount column", "amount")}
          {sel("Note column", "note", true)}
          <label className="row" style={{ gap: 8, fontSize: 12 }}><Switch on={cols.dayFirst} label="Day comes first in dates" onChange={(v) => setCols({ ...cols, dayFirst: v })} /> 01/10 = 1 Oct</label>
          <label className="row" style={{ gap: 8, fontSize: 12 }}><Switch on={cols.skipHeader} label="First row is headings" onChange={(v) => setCols({ ...cols, skipHeader: v })} /> Has headings</label>
        </div>
      )}
      {rows && (
        <>
          <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", overflow: "hidden" }}>
            {entries.slice(0, 6).map((e, i) => (
              <div key={i} className="row mono" style={{ fontSize: 11, padding: "7px 12px", borderTop: i ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
                <span className="muted" style={{ width: 90 }}>{e.date}</span>
                <span style={{ width: 60, color: e.type === "sale" ? "#A1A1AA" : "#FF5A66" }}>{e.type.toUpperCase()}</span>
                <span style={{ flexGrow: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.note}</span>
                <span>{e.type === "sale" ? "+" : "−"}{e.amount.toFixed(2)}</span>
              </div>
            ))}
            {!entries.length && <div className="muted" style={{ padding: 12, fontSize: 12 }}>No usable rows with these columns yet.</div>}
          </div>
          <div className="row">
            <span className="muted" style={{ fontSize: 12, flexGrow: 1 }}>{entries.length} entries · net {total.toFixed(2)} {currency}{entries.length > 6 ? " · showing the first 6" : ""}</span>
            <button type="button" className="btn btn-red" disabled={busy || !entries.length} onClick={() => void run()}>{busy ? "Importing…" : `Import ${entries.length}`}</button>
          </div>
        </>
      )}
    </section>
  );
}

interface RStats { name: string; playing: number; visits: number; favorites: number; upVotes: number; downVotes: number }
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/** Live players, visits and likes for a linked Roblox experience. */
function RobloxLive({ stream: x, onChange }: { stream: StreamRow; onChange: () => void }) {
  const { toast } = useApp();
  const [data, setData] = useState<{ stats: RStats | null; history: { day: string; visits: number }[] } | null>(null);
  const [linking, setLinking] = useState(false);
  const [place, setPlace] = useState("");
  useEffect(() => {
    if (!x.universeId) return setData(null);
    const load = () => api<{ stats: RStats | null; history: { day: string; visits: number }[] }>(`/api/ventures/streams/${x.id}/roblox`).then(setData).catch(() => {});
    void load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, [x.id, x.universeId]);
  const link = async () => {
    try {
      const r = await api<{ stats: RStats }>(`/api/ventures/streams/${x.id}/roblox`, { body: { place } });
      play("success");
      toast(`Linked ${r.stats.name}.`);
      setLinking(false);
      onChange();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  if (!x.universeId)
    return linking ? (
      <div className="row tx-drop" style={{ gap: 6, marginTop: 12 }}>
        <input aria-label="Roblox game link or place ID" className="field" autoFocus value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void link()} placeholder="roblox.com/games/… or place ID" style={{ height: 34, fontSize: 12, flexGrow: 1, minWidth: 0 }} />
        <button type="button" className="btn btn-red" style={{ height: 34, fontSize: 12 }} onClick={() => void link()}>Link</button>
      </div>
    ) : (
      <button type="button" className="chip" style={{ marginTop: 12 }} onClick={() => setLinking(true)}>
        <Icon d={P.plus} size={11} /> Link your game for live stats
      </button>
    );
  const s = data?.stats;
  const h = data?.history ?? [];
  const likes = s && s.upVotes + s.downVotes ? Math.round((s.upVotes / (s.upVotes + s.downVotes)) * 100) : null;
  const lo = Math.min(...h.map((p) => p.visits));
  const hi = Math.max(...h.map((p) => p.visits));
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
      {!s ? (
        <div className="muted mono" style={{ fontSize: 10 }}>Loading live stats…</div>
      ) : (
        <div className="row" style={{ gap: 10 }}>
          <span className="row mono" style={{ gap: 6, fontSize: 11 }}>
            <i style={{ width: 7, height: 7, borderRadius: "50%", background: s.playing ? "#FF2B3A" : "#52525B", boxShadow: s.playing ? "0 0 8px #FF2B3A" : undefined }} className={s.playing ? "blink" : undefined} />
            {compact(s.playing)} playing
          </span>
          <span className="mono muted" style={{ fontSize: 11, flexGrow: 1 }}>{compact(s.visits)} visits{likes !== null ? ` · ${likes}% 👍` : ""}</span>
          {h.length > 1 && (
            <svg width="60" height="20" viewBox="0 0 60 20" aria-label="Visits over time">
              <path d={h.map((p, i) => `${i ? "L" : "M"}${((i / (h.length - 1)) * 60).toFixed(1)} ${(19 - ((p.visits - lo) / (hi - lo || 1)) * 17).toFixed(1)}`).join(" ")} fill="none" stroke="#FF2B3A" strokeWidth="1.4" />
            </svg>
          )}
          <button type="button" className="chip" aria-label="Unlink game" title="Unlink game" style={{ height: 22, padding: "0 6px" }} onClick={async () => (await api(`/api/ventures/streams/${x.id}/roblox`, { method: "DELETE" }), onChange())}>
            <Icon d={P.x} size={10} />
          </button>
        </div>
      )}
    </div>
  );
}
