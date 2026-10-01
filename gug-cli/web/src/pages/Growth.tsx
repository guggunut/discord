import { useEffect, useRef, useState } from "react";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { play } from "../sfx";
import { Bars3D } from "../Bars3D";
import { Brand, Icon, P, Seg, Sigil } from "../ui";

type Platform = "instagram" | "tiktok" | "youtube" | "x" | "discord";
type Status = "idea" | "draft" | "approved" | "posted";
interface Metrics { views: number; likes: number; comments: number; shares: number }
interface Post { id: string; date: string; time: string; platform: Platform; title: string; caption: string; status: Status; metrics?: Metrics; postedAt?: string }
interface Stats {
  now: { posts: number; views: number; engagement: number; likes: number; comments: number; shares: number };
  change: { views: number | null; engagement: number | null; posts: number | null };
  rate: number;
  byPlatform: { platform: Platform; views: number }[];
  bestSlots: { slot: string; avgViews: number; posts: number }[];
}
interface Data { brand: string; posts: Post[]; stats: Stats; discord: boolean }

const PLATFORMS: [Platform, string][] = [["instagram", "Instagram"], ["tiktok", "TikTok"], ["youtube", "YouTube"], ["x", "X"], ["discord", "Discord"]];
const STATUS_LABEL: Record<Status, string> = { idea: "Idea", draft: "Draft", approved: "Approved", posted: "Posted" };
const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : n.toLocaleString());

export function Growth() {
  const { toast, state } = useApp();
  const [week, setWeek] = useState(() => monday(new Date()));
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<Post | null>(null);
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState({ goal: "", platforms: ["instagram", "tiktok"] as Platform[], count: 5 });
  const [planBusy, setPlanBusy] = useState("");
  const [brand, setBrand] = useState("");
  const [ask, setAsk] = useState("");
  const [writing, setWriting] = useState(false);
  const abortRef = useRef<() => void>(() => {});
  const selRef = useRef(sel);
  selRef.current = sel;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const from = iso(days[0]);
  const to = iso(days[6]);
  const today = iso(new Date());

  const load = async () => {
    const d = await api<Data>(`/api/growth?from=${from}&to=${to}`);
    setData(d);
    setBrand((b) => b || d.brand);
    return d;
  };
  useEffect(() => {
    void load();
  }, [from]);
  useEffect(() => () => abortRef.current(), []);

  /** Saves a post. Blur-saves don't adopt the server copy, so typing elsewhere meanwhile isn't overwritten. */
  const save = async (p: Post, adopt = true) => {
    try {
      const saved = await api<Post>(`/api/growth/posts/${p.id}`, { method: "PUT", body: p });
      if (adopt) setSel(saved);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const create = async (date: string) => {
    const p = await api<Post>("/api/growth/posts", { body: { date, time: "19:00", platform: "instagram", title: "New post", status: "idea" } });
    play("tab");
    setSel(p);
    await load();
  };
  const remove = async (p: Post) => {
    await api(`/api/growth/posts/${p.id}`, { method: "DELETE" });
    setSel(null);
    await load();
  };
  const runPlan = () => {
    play("send");
    setPlanBusy("Echo is looking at your week…");
    abortRef.current = stream("/api/growth/plan", { from, ...plan }, (ev: GugEvent | { type: "posts"; posts: Post[] }) => {
      if (ev.type === "tool") setPlanBusy(ev.detail);
      if (ev.type === "error") toast(ev.message, "err");
      if (ev.type === "posts") {
        play("success");
        toast(`Echo added ${ev.posts.length} drafts. Review and approve them.`);
        setPlanning(false);
        setSel(ev.posts[0]);
      }
    }, () => (setPlanBusy(""), void load()));
  };
  const rewrite = () => {
    if (!sel) return;
    play("send");
    setWriting(true);
    let text = "";
    const id = sel.id;
    abortRef.current = stream(`/api/growth/posts/${id}/caption`, { ask }, (ev: GugEvent) => {
      if (ev.type === "text") {
        text += ev.text;
        setSel((s) => (s && s.id === id ? { ...s, caption: text } : s));
      }
      if (ev.type === "error") toast(ev.message, "err");
    }, () => {
      setWriting(false);
      setAsk("");
      const cur = selRef.current;
      if (cur && cur.id === id && text) void save({ ...cur, caption: text, status: cur.status === "idea" ? "draft" : cur.status });
    });
  };
  const discord = async (p: Post) => {
    try {
      await save(p);
      const done = await api<Post>(`/api/growth/posts/${p.id}/discord`, { body: {} });
      play("success");
      toast("Posted to your Discord channel.");
      setSel(done);
      await load();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const copy = async (p: Post) => {
    try {
      await navigator.clipboard.writeText(p.caption);
      toast("Caption copied — paste it into the app, then mark it posted.");
    } catch {
      toast("Couldn’t copy — select the text and copy it yourself.", "err");
    }
  };

  if (!data) return <div className="muted">Loading…</div>;
  const s = data.stats;
  const maxPlat = Math.max(1, ...s.byPlatform.map((p) => p.views));
  const pending = data.posts.filter((p) => p.status === "draft").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="row rise d1" style={{ flexWrap: "wrap", gap: 10 }}>
        <button type="button" className="btn iconbtn" aria-label="Previous week" style={{ width: 40, height: 40 }} onClick={() => setWeek(addDays(week, -7))}>
          <Icon d="M15 6l-6 6 6 6" size={16} />
        </button>
        <span className="disp" style={{ fontSize: 15, minWidth: 170, textAlign: "center" }}>
          {days[0].toLocaleDateString(undefined, { day: "numeric", month: "short" })} – {days[6].toLocaleDateString(undefined, { day: "numeric", month: "short" })}
        </span>
        <button type="button" className="btn iconbtn" aria-label="Next week" style={{ width: 40, height: 40 }} onClick={() => setWeek(addDays(week, 7))}>
          <Icon d="M9 6l6 6-6 6" size={16} />
        </button>
        {from !== iso(monday(new Date())) && <button type="button" className="chip" onClick={() => setWeek(monday(new Date()))}>This week</button>}
        {pending > 0 && <span className="stat"><i />{pending} draft{pending > 1 ? "s" : ""} to review</span>}
        <span style={{ flexGrow: 1 }} />
        <button type="button" className="btn btn-red" onClick={() => setPlanning(!planning)}>
          <Icon d={P.wand} size={14} /> Plan my week with Echo
        </button>
      </div>

      {planning && (
        <section className="card hot tx-drop" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row">
            <Sigil id="echo" size={38} />
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Echo plans this week</div>
              <div className="muted" style={{ fontSize: 12 }}>Drafts land on the calendar for you to approve — nothing posts on its own.</div>
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <input aria-label="What do you do" className="field" value={brand} onChange={(e) => setBrand(e.target.value)} onBlur={() => void api("/api/growth/brand", { method: "PUT", body: { brand } })} placeholder="What you do, e.g. “desk lamps + a Roblox obby”" style={{ flex: "1 1 260px" }} />
            <input aria-label="Goal this week" className="field" value={plan.goal} onChange={(e) => setPlan({ ...plan, goal: e.target.value })} placeholder="Goal, e.g. “launch the new lamp”" style={{ flex: "1 1 220px" }} />
            <select aria-label="How many posts" className="field" value={plan.count} onChange={(e) => setPlan({ ...plan, count: Number(e.target.value) })} style={{ width: 120 }}>
              {[3, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} posts</option>)}
            </select>
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {PLATFORMS.map(([p, l]) => {
              const on = plan.platforms.includes(p);
              return (
                <button key={p} type="button" className="chip" aria-pressed={on} onClick={() => setPlan({ ...plan, platforms: on ? plan.platforms.filter((x) => x !== p) : [...plan.platforms, p] })} style={on ? { borderColor: "rgba(255,43,58,0.6)", color: "#fff", background: "rgba(255,43,58,0.14)" } : undefined}>
                  {l}
                </button>
              );
            })}
            <span style={{ flexGrow: 1 }} />
            {planBusy && <span className="mono muted" style={{ fontSize: 11 }}>{planBusy}</span>}
            <button type="button" className="btn btn-red" data-sfx="none" disabled={!!planBusy || !plan.platforms.length || !state.engines.claudeKeys} title={state.engines.claudeKeys ? "" : "Add a Claude key first"} onClick={runPlan}>
              {planBusy ? "Planning…" : "Plan it"}
            </button>
          </div>
        </section>
      )}

      <div className="k4">
        <Kpi i={0} label="Reach" value={short(s.now.views)} change={s.change.views} />
        <Kpi i={1} label="Engagement" value={short(s.now.engagement)} change={s.change.engagement} hot />
        <Kpi i={2} label="Engagement rate" value={`${s.rate}%`} change={null} hint="likes + comments + shares ÷ views" />
        <Kpi i={3} label="Published" value={String(s.now.posts)} change={s.change.posts} />
      </div>

      <div className="g2r">
        <section style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
          <div className="card rise d3" style={{ padding: 14 }}>
            <div className="growth-week">
              {days.map((d, i) => {
                const key = iso(d);
                const posts = data.posts.filter((p) => p.date === key).sort((a, b) => a.time.localeCompare(b.time));
                return (
                  <div key={key} className={`growth-day ${key === today ? "today" : ""}`}>
                    <div className="row" style={{ gap: 6, padding: "2px 2px 8px" }}>
                      <span className="mono" style={{ fontSize: 9, letterSpacing: ".12em", color: key === today ? "#FF2B3A" : "#71717A", flexGrow: 1 }}>{DAYS[i]}</span>
                      <span className="disp" style={{ fontSize: 16 }}>{d.getDate()}</span>
                    </div>
                    {posts.map((p) => (
                      <button key={p.id} type="button" data-sfx="tab" className={`growth-post s-${p.status} ${sel?.id === p.id ? "on" : ""}`} onClick={() => (setSel(p), setAsk(""))}>
                        <span className="row" style={{ gap: 5 }}>
                          <Brand name={p.platform} size={18} variant={p.status === "posted" ? "red" : ""} />
                          <span className="mono" style={{ fontSize: 9, color: "#A1A1AA" }}>{p.time}</span>
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.3 }}>{p.title}</span>
                        <span className="mono" style={{ fontSize: 8, letterSpacing: ".1em" }}>{STATUS_LABEL[p.status].toUpperCase()}</span>
                      </button>
                    ))}
                    <button type="button" className="growth-add" aria-label={`Add a post on ${key}`} onClick={() => void create(key)}>
                      <Icon d={P.plus} size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
            {!data.posts.length && <p className="muted" style={{ fontSize: 13, margin: "12px 4px 2px" }}>Nothing scheduled. Ask Echo to fill the week, or press + on a day.</p>}
          </div>

          <div className="card rise d4" style={{ padding: 18 }}>
            <h2 className="disp" style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 400 }}>Reach by platform</h2>
            <Bars3D height={220} data={s.byPlatform.map((p) => ({ label: PLATFORMS.find(([k]) => k === p.platform)?.[1] ?? p.platform, value: p.views }))} format={(n) => `${short(n)} views`} />
            <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>Log views and likes on posted items to fill this in.</p>
          </div>

          {s.bestSlots.length > 0 && (
            <div className="card rise d5" style={{ padding: 18 }}>
              <h2 className="disp" style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 400 }}>When your posts do best</h2>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
                {s.bestSlots.map((b, i) => (
                  <div key={b.slot} style={{ padding: "12px 14px", borderRadius: 14, background: i === 0 ? "linear-gradient(160deg, rgba(255,43,58,0.18), rgba(255,255,255,0.02))" : "rgba(255,255,255,0.03)", border: `1px solid ${i === 0 ? "rgba(255,43,58,0.45)" : "rgba(255,255,255,0.06)"}` }}>
                    <div className="mono" style={{ fontSize: 10, color: i === 0 ? "#FF5A66" : "#71717A" }}>#{i + 1}</div>
                    <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{b.slot}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{short(b.avgViews)} avg views · {b.posts} post{b.posts > 1 ? "s" : ""}</div>
                  </div>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 11, margin: "10px 0 0" }}>From every post you’ve logged. Echo uses this when it plans your week.</p>
            </div>
          )}
        </section>

        <section className="card hot rise d4" style={{ padding: 18, alignSelf: "start", display: "flex", flexDirection: "column", gap: 12 }}>
          {!sel ? (
            <div style={{ padding: "30px 10px", textAlign: "center" }}>
              <Sigil id="echo" size={44} />
              <p className="muted" style={{ fontSize: 13 }}>Pick a post to edit it, or let Echo plan the week.</p>
            </div>
          ) : (
            <div key={sel.id} className="tx-slide" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <input aria-label="Post title" value={sel.title} onChange={(e) => setSel({ ...sel, title: e.target.value })} onBlur={() => selRef.current && void save(selRef.current, false)} style={{ border: 0, outline: 0, background: "transparent", fontSize: 17, fontWeight: 600, color: "#F4F4F5" }} />
              <div className="row" style={{ gap: 8 }}>
                <select aria-label="Platform" className="field" value={sel.platform} onChange={(e) => void save({ ...sel, platform: e.target.value as Platform })} style={{ flex: "1 1 0", minWidth: 0, height: 40 }}>
                  {PLATFORMS.map(([p, l]) => <option key={p} value={p}>{l}</option>)}
                </select>
                <input aria-label="Date" type="date" className="field" value={sel.date} onChange={(e) => e.target.value && void save({ ...sel, date: e.target.value })} style={{ flex: "1.6 1 0", minWidth: 0, height: 40, padding: "0 10px" }} />
                <input aria-label="Time" type="time" className="field" value={sel.time} onChange={(e) => e.target.value && void save({ ...sel, time: e.target.value })} style={{ flex: "1 1 0", minWidth: 0, height: 40, padding: "0 10px" }} />
              </div>
              <Seg label="Status" value={sel.status} options={[["idea", "Idea"], ["draft", "Draft"], ["approved", "Approve"], ["posted", "Posted"]]} onChange={(st) => void save({ ...sel, status: st })} />
              <textarea aria-label="Caption" className="field" rows={7} value={sel.caption} onChange={(e) => setSel({ ...sel, caption: e.target.value })} onBlur={() => selRef.current && void save(selRef.current, false)} placeholder="Caption…" style={{ fontSize: 13, lineHeight: 1.6 }} />
              <div className="row" style={{ gap: 6 }}>
                <input aria-label="Ask Echo to change the caption" className="field" value={ask} onChange={(e) => setAsk(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rewrite()} placeholder={sel.caption ? "e.g. shorter, funnier" : "Echo writes it for you"} style={{ height: 40, flexGrow: 1 }} />
                <button type="button" className="btn btn-red" data-sfx="none" style={{ height: 40 }} disabled={writing || !state.engines.claudeKeys} onClick={rewrite}>
                  <Icon d={P.wand} size={13} /> {writing ? "…" : sel.caption ? "Rewrite" : "Write"}
                </button>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {sel.platform === "discord" && sel.status !== "posted" && (
                  <button type="button" className="btn btn-white" disabled={!data.discord || !sel.caption} title={data.discord ? "" : "Connect Discord in Apps"} onClick={() => void discord(sel)}>
                    <Icon d={P.send} size={13} /> Post to Discord
                  </button>
                )}
                <button type="button" className="btn" disabled={!sel.caption} onClick={() => void copy(sel)}><Icon d={P.copy} size={13} /> Copy</button>
                <span style={{ flexGrow: 1 }} />
                <button type="button" className="chip" style={{ color: "#FF5A66" }} onClick={() => void remove(sel)}><Icon d={P.x} size={11} /> Delete</button>
              </div>
              {sel.status === "posted" && (
                <div style={{ paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>How did it do?</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 6 }}>
                    {(["views", "likes", "comments", "shares"] as const).map((k) => (
                      <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span className="mono muted" style={{ fontSize: 9 }}>{k.toUpperCase()}</span>
                        <input
                          className="field mono"
                          inputMode="numeric"
                          value={sel.metrics?.[k] ?? ""}
                          onChange={(e) => setSel({ ...sel, metrics: { views: 0, likes: 0, comments: 0, shares: 0, ...sel.metrics, [k]: Number(e.target.value.replace(/\D/g, "")) } })}
                          onBlur={() => selRef.current && void save(selRef.current, false)}
                          style={{ height: 36, padding: "0 8px", minWidth: 0 }}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Kpi({ label, value, change, hot, i, hint }: { label: string; value: string; change: number | null; hot?: boolean; i: number; hint?: string }) {
  return (
    <section className={`card tilt rise ${hot ? "hot" : ""}`} style={{ padding: "16px 18px", animationDelay: `${0.15 + i * 0.07}s` }}>
      <div className="row">
        <span className="eyebrow" style={{ fontSize: 10, flexGrow: 1 }}>{label}</span>
        {change !== null && <span className="mono" style={{ fontSize: 11, color: change >= 0 ? "#F4F4F5" : "#FF5A66" }}>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}%</span>}
      </div>
      <div className="disp" style={{ fontSize: 30, fontWeight: 300, marginTop: 8, color: hot ? "#FF2B3A" : undefined }}>{value}</div>
      <div className="muted" style={{ fontSize: 11 }}>{hint ?? "this week vs last"}</div>
    </section>
  );
}
