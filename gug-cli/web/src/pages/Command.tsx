import { useEffect, useRef, useState } from "react";
import { api, stream, type AgentInfo, type Engine, type GugEvent, type Mode } from "../api";
import { useApp } from "../App";
import { Core } from "../Core";
import { MediaCard } from "../Media";
import { Md } from "../Md";
import { play } from "../sfx";
import { Brand, Icon, P, Seg, Sigil } from "../ui";

interface Line {
  id: number;
  agent: string; // agent id or "you"
  text: string;
  model?: string;
  error?: boolean;
  tools?: string[];
}

const ENGINE_HINT: Record<Engine, string> = {
  auto: "Auto picks per task: Claude Code for repo work, Claude for thinking and writing, a local model when you ask for private/offline.",
  claude: "Claude in the cloud — best for reasoning, research, writing and planning.",
  code: "Claude Code — works inside your playground project: edits files and runs commands. Best for real code.",
  local: "Your local model — free, private and offline. Set it up in Settings → Engines.",
};

export function Command() {
  const { state, go } = useApp();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sel, setSel] = useState<string[]>(() => JSON.parse(localStorage.getItem("gug-sel") ?? '["atlas","scout"]'));
  const [mode, setMode] = useState<Mode>("deep");
  const [how, setHow] = useState<"turns" | "team">(() => (localStorage.getItem("gug-how") === "team" ? "team" : "turns"));
  const [engine, setEngine] = useState<Engine>("auto");
  const [draft, setDraft] = useState(() => {
    const pf = localStorage.getItem("gug-prefill") ?? "";
    localStorage.removeItem("gug-prefill");
    return pf;
  });
  const [busy, setBusy] = useState(false);
  // The channel survives reloads and screen changes (last 60 lines, this browser only).
  const [lines, setLines] = useState<Line[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("gug-channel") ?? "[]");
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (busy) return;
    try {
      localStorage.setItem("gug-channel", JSON.stringify(lines.slice(-60)));
    } catch {
      /* storage full or private mode */
    }
  }, [lines, busy]);
  const [voice, setVoice] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  type Rec = { lang: string; interimResults: boolean; continuous: boolean; onresult: (e: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void; onend: () => void; onerror: (e: { error: string }) => void; start: () => void; stop: () => void };
  const SpeechRec = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
  const hasSpeech = !!SpeechRec;
  // Speech to text into the composer; the core shows the listening state while it runs.
  const toggleVoice = () => {
    if (voice) return recRef.current?.stop();
    if (!SpeechRec) return;
    const rec = new SpeechRec();
    rec.lang = navigator.language || "en-GB";
    rec.interimResults = true;
    rec.continuous = false;
    const before = draft ? `${draft.trim()} ` : "";
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setDraft(before + text);
    };
    rec.onerror = (e) => e.error !== "aborted" && e.error !== "no-speech" && play("error");
    rec.onend = () => {
      setVoice(false);
      recRef.current = null;
    };
    recRef.current = rec;
    setVoice(true);
    play("tab");
    rec.start();
  };
  useEffect(() => () => recRef.current?.stop(), []);
  const abortRef = useRef<() => void>(() => {});
  const feedRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Math.max(0, ...lines.map((l) => l.id)) + 1);

  useEffect(() => {
    api<AgentInfo[]>("/api/agents").then(setAgents).catch(() => {});
    return () => abortRef.current();
  }, []);
  useEffect(() => localStorage.setItem("gug-sel", JSON.stringify(sel)), [sel]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-6)));
  const names = sel.map((id) => agents.find((a) => a.id === id)?.name ?? id);

  const send = () => {
    const text = draft.trim();
    if (!text || busy || !sel.length) return;
    play("send");
    setDraft("");
    setBusy(true);
    setLines((l) => [...l, { id: idRef.current++, agent: "you", text }]);
    const onEvent = (ev: GugEvent) => {
      setLines((l) => {
        const out = [...l];
        const agent = ("agent" in ev && ev.agent) || sel[0];
        let cur = out[out.length - 1];
        const startNew = () => {
          cur = { id: idRef.current++, agent, text: "" };
          out.push(cur);
        };
        if (ev.type === "start") {
          if (!cur || cur.agent !== agent || cur.text) startNew();
          cur.model = ev.model ?? ev.engine;
        } else if (ev.type === "text") {
          if (!cur || cur.agent !== agent) startNew();
          cur.text += ev.text;
        } else if (ev.type === "tool") {
          if (!cur || cur.agent !== agent) startNew();
          cur.tools = [...(cur.tools ?? []), `${ev.name} ${ev.detail}`];
        } else if (ev.type === "fallback") {
          out.push({ id: idRef.current++, agent: "router", text: `Switched ${ev.from} → ${ev.to ?? "next"}${ev.reason ? ` (${ev.reason})` : ""}` });
        } else if (ev.type === "error") {
          out.push({ id: idRef.current++, agent, text: ev.message, error: true });
        }
        return out.map((x) => ({ ...x }));
      });
    };
    const done = () => {
      setBusy(false);
      play("success");
    };
    // One agent → direct chat (any engine). Several → they take turns and build on each other.
    abortRef.current =
      sel.length === 1 ? stream("/api/chat", { agent: sel[0], text, mode, engine }, onEvent, done) : stream("/api/roundtable", { agents: sel, prompt: text, mode, team: how === "team" }, onEvent, done);
  };

  const noKey = !state.engines.claudeKeys;

  return (
    <div className="c3">
      <section className="rise d2" style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
            <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>
              Agents
            </h2>
            <span className="mono" style={{ fontSize: 11, color: "#A1A1AA" }}>
              {sel.length} IN CHAT
            </span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
            {agents.map((a) => {
              const on = sel.includes(a.id);
              return (
                <button key={a.id} type="button" aria-pressed={on} title={`${a.name} · ${a.role}`} onClick={() => toggle(a.id)} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "12px 4px 10px", borderRadius: 14, border: `1px solid ${on ? "rgba(255,43,58,0.55)" : "rgba(255,255,255,0.07)"}`, background: on ? "linear-gradient(160deg, rgba(255,43,58,0.16), rgba(255,43,58,0.02))" : "rgba(255,255,255,0.02)", transition: "all .3s cubic-bezier(.2,.8,.2,1)" }}>
                  <Sigil id={a.id} size={36} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>{a.name}</span>
                  <span className="mono" style={{ fontSize: 9, color: "#A1A1AA" }}>
                    {a.role.split(" ")[0]}
                  </span>
                  {on && (
                    <span className="pop" style={{ position: "absolute", top: 6, right: 6, width: 16, height: 16, borderRadius: 5, background: "#FF2B3A", display: "grid", placeItems: "center", boxShadow: "0 0 10px #FF2B3A" }}>
                      <Icon d={P.check} size={10} sw={3.4} color="#fff" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <GettingStarted />
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="rise d3">
          <Core crew={sel} active={busy ? lines.at(-1)?.agent : undefined} mode={mode} busy={busy} voice={voice} label={busy ? "Thinking" : voice ? "Listening" : noKey ? "Add a Claude key to wake me" : "Core online"} />
        </div>
        <div className="card rise d4" style={{ padding: "14px 14px 12px", borderRadius: 22 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minHeight: 30, marginBottom: 4 }}>
            <span className="eyebrow" style={{ fontSize: 10, marginRight: 4 }}>
              To
            </span>
            {sel.map((id, i) => (
              <button key={id} type="button" className="chip pop" onClick={() => toggle(id)} aria-label={`Remove ${names[i]}`} style={{ height: 28, padding: "0 8px 0 10px", borderColor: "rgba(255,43,58,0.5)" }}>
                {names[i]} <Icon d={P.x} size={12} sw={2} />
              </button>
            ))}
            {!sel.length && <span className="fade err-text" style={{ fontSize: 12 }}>Pick at least one agent</span>}
            {sel.length > 1 && (
              <span className="row" style={{ marginLeft: "auto", gap: 8 }}>
                <span className="muted hide-sm" style={{ fontSize: 11 }}>{how === "team" ? "Atlas hands out tasks, then combines the work" : "They take turns and build on each other"}</span>
                <Seg label="How they work" value={how} width={190} options={[["turns", "Turns"], ["team", "Team"]]} onChange={(v) => (setHow(v), localStorage.setItem("gug-how", v))} />
              </span>
            )}
          </div>
          <label className="sr" htmlFor="composer">
            Message your agents
          </label>
          <input id="composer" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), send())} placeholder={noKey ? "First add a Claude API key in Settings → API keys" : sel.length ? `Message ${names.join(" + ")}…` : "Select agents on the left"} style={{ width: "100%", height: 46, border: 0, outline: 0, background: "transparent", fontSize: 16, color: "#F4F4F5" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <Seg label="Mode" value={mode} onChange={setMode} width={290} options={[["fast", "Fast"], ["deep", "Deep"], ["debate", "Debate"], ["build", "Build"]]} />
            <div style={{ flexGrow: 1 }} />
            <button type="button" aria-pressed={voice} aria-label={voice ? "Stop listening" : "Speak your message"} title={hasSpeech ? "Speak instead of typing (uses your browser’s speech service)" : "Your browser doesn’t support speech input — try Chrome or Edge"} className="btn" style={{ width: 44, padding: 0, background: voice ? "#FF2B3A" : undefined, borderColor: voice ? "#FF2B3A" : undefined, opacity: hasSpeech ? 1 : 0.5 }} onClick={toggleVoice}>
              <Icon d={P.mic} size={17} />
            </button>
            {busy ? (
              <button type="button" className="btn" aria-label="Stop" onClick={() => (abortRef.current(), setBusy(false))} style={{ width: 48, padding: 0 }}>
                <Icon d="M7 7h10v10H7z" size={16} />
              </button>
            ) : (
              <button type="button" className="btn btn-red" data-sfx="none" aria-label="Send" onClick={send} style={{ width: 48, padding: 0 }}>
                <Icon d={P.send} size={18} sw={2.2} />
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <span className="eyebrow" style={{ fontSize: 10 }}>
              Engine
            </span>
            <Seg label="Engine" value={engine} onChange={setEngine} width={440} options={[["auto", "Auto"], ["claude", "Claude"], ["code", "Claude Code"], ["local", "Local"]]} />
            <span style={{ flexBasis: "100%", fontSize: 12, color: "#A1A1AA", lineHeight: 1.5 }}>
              {sel.length > 1 ? "Group chats run on Claude so every agent can see the others’ answers." : ENGINE_HINT[engine]}
            </span>
          </div>
        </div>
      </section>

      <section className="rise d4" style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        <MediaCard />
        <div className="card" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>
              Agent channel
            </h2>
            {busy ? (
              <span className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10, letterSpacing: ".14em", color: "#FF2B3A" }}>
                <span className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF2B3A" }} />
                LIVE
              </span>
            ) : (
              lines.length > 0 && (
                <button type="button" className="chip" onClick={() => setLines([])}>
                  Clear
                </button>
              )
            )}
          </div>
          <div ref={feedRef} className="scroll" style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 520, minHeight: 120 }}>
            {!lines.length && (
              <div className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
                Ask something below. Pick one agent for a direct chat, or several to have them work it out together.
                {noKey && (
                  <button type="button" className="btn btn-red" style={{ marginTop: 12, width: "100%" }} onClick={() => go("guide")}>
                    Set up your first AI <Icon d={P.arrow} size={14} />
                  </button>
                )}
              </div>
            )}
            {lines.map((l) =>
              l.agent === "you" ? (
                <div key={l.id} className="bubble-me pop">
                  {l.text}
                </div>
              ) : l.agent === "router" ? (
                <div key={l.id} className="mono fade" style={{ fontSize: 11, color: "#A1A1AA" }}>
                  ↻ {l.text}
                </div>
              ) : (
                <div key={l.id} className="pop" style={{ display: "flex", gap: 10 }}>
                  <Sigil id={l.agent} size={30} glow={false} />
                  <div style={{ minWidth: 0, flexGrow: 1 }}>
                    <div style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "center" }}>
                      <b>{agents.find((a) => a.id === l.agent)?.name ?? l.agent}</b>
                      {l.model && <span className="mono muted" style={{ fontSize: 10 }}>{l.model}</span>}
                    </div>
                    {l.tools?.map((t, i) => (
                      <div key={i} className="mono" style={{ fontSize: 11, color: "#FF5A66", marginTop: 4 }}>
                        ▸ {t}
                      </div>
                    ))}
                    <div className="bubble-ai" style={{ marginTop: 4, borderColor: l.error ? "rgba(255,43,58,0.5)" : undefined, color: l.error ? "#FF8A93" : undefined }}>
                      {l.text ? <Md text={l.text} /> : <span className="dots3"><span /><span /><span /></span>}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function GettingStarted() {
  const { state } = useApp();
  const [tab, setTab] = useState<"setup" | "today">(() => (state.engines.claudeKeys > 0 ? "today" : "setup"));
  const [todos, setTodos] = useState<{ t: string; done: boolean }[]>(() => JSON.parse(localStorage.getItem("gug-todos") ?? "[]"));
  const [newTodo, setNewTodo] = useState("");
  useEffect(() => localStorage.setItem("gug-todos", JSON.stringify(todos)), [todos]);
  const steps: [string, boolean, string][] = [
    ["Open GUG-cli with your private link", true, "#/account"],
    ["Add a Claude API key", state.engines.claudeKeys > 0, "#/guide"],
    ["Install Claude Code for real coding", state.engines.claudeCode.ok, "#/guide"],
    ["Connect GitHub", state.vault.some((v) => v.name === "github"), "#/apps"],
    ["Vibe-code something in Code", false, "#/code"],
  ];
  const done = steps.filter((s) => s[1]).length;
  return (
    <div className="card" style={{ padding: "14px 16px 12px" }}>
      <Seg label="Left panel" value={tab} onChange={setTab} options={[["setup", "Get started"], ["today", "Today"]]} />
      {tab === "setup" ? (
        <div className="tx-flip" style={{ marginTop: 12 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{done} of 5 done</div>
          <div style={{ height: 3, borderRadius: 3, background: "rgba(255,255,255,0.07)", marginBottom: 6, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${(done / 5) * 100}%`, background: "#FF2B3A", boxShadow: "0 0 10px #FF2B3A", transition: "width .6s" }} />
          </div>
          {steps.map(([label, ok, href], i) => (
            <a key={label} href={href} className="listbtn" style={{ minHeight: 42, padding: "6px 4px", textDecoration: "none", color: ok ? "#71717A" : "#F4F4F5" }}>
              <span className="mono" style={{ width: 22, height: 22, flexShrink: 0, borderRadius: 7, display: "grid", placeItems: "center", fontSize: 10, border: `1.5px solid ${ok ? "#FF2B3A" : "rgba(255,255,255,0.25)"}`, background: ok ? "#FF2B3A" : "transparent", color: "#fff" }}>
                {ok ? <Icon d={P.check} size={11} sw={3} color="#fff" /> : i + 1}
              </span>
              <span style={{ flexGrow: 1, fontSize: 13, textDecoration: ok ? "line-through" : "none" }}>{label}</span>
            </a>
          ))}
        </div>
      ) : (
        <div className="tx-skew" style={{ marginTop: 12 }}>
          <Briefing />
          <div className="eyebrow" style={{ fontSize: 10, margin: "14px 0 8px" }}>Your tasks</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <label className="sr" htmlFor="todo">
              New task
            </label>
            <input id="todo" className="field" style={{ flexGrow: 1, height: 38, fontSize: 13 }} placeholder="Add a task for today" value={newTodo} onChange={(e) => setNewTodo(e.target.value)} onKeyDown={(e) => {
              if (e.key === "Enter" && newTodo.trim()) {
                setTodos((t) => [...t, { t: newTodo.trim(), done: false }]);
                setNewTodo("");
              }
            }} />
          </div>
          {!todos.length && <div className="muted" style={{ fontSize: 12, padding: "8px 2px" }}>Nothing yet. Type above and press Enter.</div>}
          {todos.map((t, i) => (
            <label key={i} style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 40, fontSize: 13, cursor: "pointer", color: t.done ? "#71717A" : "#F4F4F5" }}>
              <input type="checkbox" checked={t.done} onChange={() => setTodos((all) => all.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} style={{ width: 18, height: 18, accentColor: "#FF2B3A", margin: 0 }} />
              <span style={{ flexGrow: 1, textDecoration: t.done ? "line-through" : "none" }}>{t.t}</span>
              <button type="button" className="chip" aria-label={`Delete ${t.t}`} style={{ height: 24, padding: "0 8px" }} onClick={(e) => (e.preventDefault(), setTodos((all) => all.filter((_, j) => j !== i)))}>
                <Icon d={P.x} size={11} />
              </button>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface Today {
  inbox: { unread: number; latest: { id: string; title: string; at: string; read: boolean }[] };
  posts: { id: string; time: string; platform: string; title: string; status: string }[];
  money: { currency: string; today: number; week: number; weekChange: number | null } | null;
  movers: { label: string; price: number; currency: string; changePct: number }[];
  nextFlow: { name: string; at: string } | null;
  focus: { today: number; week: number; streak: number };
}

/** A small live briefing: inbox, today's posts, money, market movers and the next automation. */
function Briefing() {
  const [t, setT] = useState<Today | null>(null);
  useEffect(() => {
    const load = () => api<Today>("/api/today").then(setT).catch(() => {});
    void load();
    const id = window.setInterval(load, 60_000);
    return () => window.clearInterval(id);
  }, []);
  if (!t) return <div className="muted" style={{ fontSize: 12 }}>Gathering your day…</div>;
  const money = (n: number, cur: string) => {
    try {
      return new Intl.NumberFormat(undefined, { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${Math.round(n)} ${cur}`;
    }
  };
  const row = (href: string, icon: React.ReactNode, label: React.ReactNode, right?: React.ReactNode, k?: string) => (
    <a key={k} href={href} className="listbtn" style={{ minHeight: 38, padding: "4px 4px", textDecoration: "none", color: "#F4F4F5", gap: 10 }}>
      <span style={{ width: 26, display: "grid", placeItems: "center", flexShrink: 0 }}>{icon}</span>
      <span style={{ flexGrow: 1, minWidth: 0, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      {right && <span style={{ flexShrink: 0, whiteSpace: "nowrap" }}>{right}</span>}
    </a>
  );
  const empty = !t.inbox.unread && !t.posts.length && !t.money && !t.movers.length && !t.nextFlow && !t.focus.today;
  return (
    <div>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>
        {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
      </div>
      {empty && <div className="muted" style={{ fontSize: 12, padding: "4px 2px" }}>Quiet so far. Add a flow, a stream or a watchlist and they’ll show up here.</div>}
      {t.inbox.unread > 0 &&
        row("#/flows", <Icon d={P.Flows} size={16} color="#FF2B3A" />, <><b>{t.inbox.unread}</b> new in your inbox <span className="muted">· {t.inbox.latest[0]?.title}</span></>, <span className="mono" style={{ fontSize: 9, color: "#FF2B3A" }}>NEW</span>, "inbox")}
      {t.posts.map((p) =>
        row("#/growth", <Brand name={p.platform} size={22} variant={p.status === "posted" ? "red" : ""} />, <>{p.title}</>, <span className="mono muted" style={{ fontSize: 10 }}>{p.time} · {p.status.toUpperCase()}</span>, p.id),
      )}
      {t.money &&
        row(
          "#/ventures",
          <Icon d={P.Ventures} size={16} />,
          <>Profit today <b>{money(t.money.today, t.money.currency)}</b> <span className="muted">· week {money(t.money.week, t.money.currency)}</span></>,
          t.money.weekChange !== null ? <span className="mono" style={{ fontSize: 10, color: t.money.weekChange >= 0 ? "#A1A1AA" : "#FF5A66" }}>{t.money.weekChange >= 0 ? "▲" : "▼"} {Math.abs(t.money.weekChange)}%</span> : undefined,
          "money",
        )}
      {t.movers.map((m) =>
        row("#/markets", <Icon d={P.Markets} size={16} color={m.changePct >= 0 ? "#F4F4F5" : "#FF2B3A"} />, <><b>{m.label}</b> <span className="muted">{m.changePct >= 0 ? "up" : "down"} today</span></>, <span className="mono" style={{ fontSize: 10, color: m.changePct >= 0 ? "#F4F4F5" : "#FF5A66" }}>{m.changePct >= 0 ? "▲" : "▼"} {Math.abs(m.changePct).toFixed(2)}%</span>, `m-${m.label}`),
      )}
      {(t.focus.today > 0 || t.focus.streak > 0) &&
        row("#/command", <Icon d={P.check} size={15} color="#FF2B3A" />, <>Focused <b>{t.focus.today} min</b> today <span className="muted">· {t.focus.week} this week</span></>, t.focus.streak > 1 ? <span className="mono" style={{ fontSize: 10, color: "#FF5A66" }}>{t.focus.streak}-DAY STREAK</span> : undefined, "focus")}
      {t.nextFlow &&
        row("#/flows", <Icon d={P.refresh} size={15} />, <>Next: <b>{t.nextFlow.name}</b></>, <span className="mono muted" style={{ fontSize: 10 }}>{new Date(t.nextFlow.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>, "flow")}
    </div>
  );
}
