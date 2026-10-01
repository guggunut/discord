import { useEffect, useRef, useState } from "react";
import { api, stream, type AgentInfo, type Engine, type GugEvent } from "../api";
import { useApp } from "../App";
import { Md } from "../Md";
import { play } from "../sfx";
import { AGENT_META, Icon, P, Seg, Sigil, Switch } from "../ui";

interface Msg {
  role: "user" | "assistant";
  content: string;
  model?: string;
  engine?: string;
  tools?: string[];
  error?: boolean;
}

const CATS: [string, string][] = [["all", "All"], ["business", "Business"], ["markets", "Markets"], ["creative", "Creative"], ["productivity", "Productivity"], ["system", "System"]];
const ABOUT: Record<string, string[]> = {
  atlas: ["Breaks big asks into steps", "Says which agent should own each step", "Ends with the one decision you need to make"],
  ledger: ["Margins, budgets and pricing maths", "Dropshipping, Roblox and digital product income", "Never moves money"],
  quant: ["Explains markets and risk clearly", "Prefers paper trading", "Not financial advice"],
  muse: ["Image and video prompts", "Shot lists and creative briefs", "On-brand: black, white, signal red"],
  echo: ["Hooks, captions and posting plans", "Ad angles and campaign ideas", "Never makes claims a product can’t back up"],
  relay: ["Designs automations step by step", "Names the apps and credentials needed", "Flags anything risky"],
  scout: ["Structured research briefs", "Separates facts from guesses", "Says which sources would confirm each claim"],
  forge: ["Writes and fixes code", "Uses Claude Code inside your projects when installed", "Small, reviewable changes with test steps"],
  vox: ["Voiceover scripts with timing", "Music briefs and podcast outlines"],
  tempo: ["Turns to-do lists into realistic schedules", "Plans focus blocks and buffers"],
  sage: ["Explains anything step by step", "Checks your understanding", "Defines jargon the first time"],
  sentinel: ["Reviews setups for security and privacy risks", "Gives prioritised, practical fixes"],
};

export function Agents() {
  const { state, refresh, toast } = useApp();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [cat, setCat] = useState("all");
  const [cur, setCur] = useState(() => localStorage.getItem("gug-agent") ?? "forge");
  const [tab, setTab] = useState<"chat" | "about" | "settings">("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState(() => {
    const pf = localStorage.getItem("gug-prefill") ?? "";
    localStorage.removeItem("gug-prefill");
    return pf;
  });
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<() => void>(() => {});
  const feedRef = useRef<HTMLDivElement>(null);

  const loadAgents = () => api<AgentInfo[]>("/api/agents").then(setAgents).catch(() => {});
  // The command palette can hand us an agent and a message while this screen is already open.
  useEffect(() => {
    const take = () => {
      const a = localStorage.getItem("gug-agent");
      const pf = localStorage.getItem("gug-prefill");
      localStorage.removeItem("gug-prefill");
      if (a) setCur(a);
      if (pf) setDraft(pf);
      setTab("chat");
    };
    window.addEventListener("gug-prefill", take);
    return () => window.removeEventListener("gug-prefill", take);
  }, []);
  useEffect(() => {
    void loadAgents();
    return () => abortRef.current();
  }, []);
  useEffect(() => {
    localStorage.setItem("gug-agent", cur);
    abortRef.current();
    setBusy(false);
    api<Msg[]>(`/api/agents/${cur}/history`).then(setMsgs).catch(() => setMsgs([]));
  }, [cur]);
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, tab]);

  const a = agents.find((x) => x.id === cur);
  const list = agents.filter((x) => cat === "all" || x.category === cat);

  const save = async (patch: Partial<{ engine: Engine; autonomy: string; enabled: boolean }>) => {
    await api("/api/prefs", { method: "PATCH", body: { agents: { [cur]: patch } } });
    await loadAgents();
    void refresh();
  };

  const send = () => {
    const text = draft.trim();
    if (!text || busy) return;
    play("send");
    setDraft("");
    setBusy(true);
    setMsgs((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "" }]);
    const onEvent = (ev: GugEvent) =>
      setMsgs((m) => {
        const out = [...m];
        const last = { ...out[out.length - 1] };
        if (ev.type === "text") last.content += ev.text;
        if (ev.type === "start") (last.model = ev.model ?? last.model), (last.engine = ev.engine);
        if (ev.type === "tool") last.tools = [...(last.tools ?? []), `${ev.name} ${ev.detail}`];
        if (ev.type === "fallback") last.tools = [...(last.tools ?? []), `router: ${ev.from} → ${ev.to ?? "next"} ${ev.reason ? `(${ev.reason})` : ""}`];
        if (ev.type === "error") (last.content += (last.content ? "\n\n" : "") + ev.message), (last.error = true);
        out[out.length - 1] = last;
        return out;
      });
    abortRef.current = stream("/api/chat", { agent: cur, text, mode: "deep", engine: "auto", project: "playground" }, onEvent, () => {
      setBusy(false);
      play("success");
      void loadAgents();
    });
  };

  const clear = async () => {
    await api(`/api/agents/${cur}/history`, { method: "DELETE" });
    setMsgs([]);
    toast(`Cleared your chat with ${a?.name}.`);
  };

  const tone = AGENT_META[cur]?.tone ?? "#F4F4F5";
  const engineLabel = (e: Engine) => ({ auto: "Auto", claude: "Claude", code: "Claude Code", local: "Local" })[e];

  return (
    <div className="g3" style={{ gridTemplateColumns: "300px minmax(0,1fr) 300px" }}>
      <section className="card rise d2" style={{ padding: "16px 12px", alignSelf: "start" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", padding: "0 6px 10px" }}>
          <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>
            Your AIs
          </h2>
          <span className="mono" style={{ fontSize: 11, color: "#A1A1AA" }}>
            {list.length} SHOWN
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 4px" }}>
          {CATS.map(([id, label]) => (
            <button key={id} type="button" data-sfx="tab" className="chip" aria-pressed={cat === id} onClick={() => setCat(id)} style={{ height: 28, background: cat === id ? "#F4F4F5" : undefined, color: cat === id ? "#050505" : undefined, borderColor: cat === id ? "#F4F4F5" : undefined, transition: "all .3s" }}>
              {label}
            </button>
          ))}
        </div>
        <div key={cat} className="tx-skew" style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 12 }}>
          {list.map((x) => (
            <button key={x.id} type="button" data-sfx="tab" className="listbtn" onClick={() => (setCur(x.id), setTab("chat"))} style={{ minHeight: 54, background: x.id === cur ? "linear-gradient(90deg, rgba(255,43,58,0.14), rgba(255,43,58,0))" : undefined, borderColor: x.id === cur ? "rgba(255,43,58,0.45)" : "transparent", opacity: x.enabled ? 1 : 0.5 }}>
              <Sigil id={x.id} size={34} />
              <span style={{ flexGrow: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{x.name}</span>
                <span style={{ display: "block", fontSize: 11, color: "#A1A1AA", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {x.role} · {engineLabel(x.engine)}
                </span>
              </span>
              {x.messages > 0 && <span className="mono" style={{ fontSize: 10, color: "#71717A" }}>{x.messages}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="card rise d3" style={{ padding: 24, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {a && (
          <>
            <div key={cur} className="tx-zoom" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
              <div className="stage" style={{ width: 104, height: 104, borderRadius: "50%", overflow: "visible", flexShrink: 0 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.12)", borderTopColor: tone, animation: "spinz 14s linear infinite" }} />
                <span style={{ position: "absolute", inset: 12, borderRadius: "50%", border: "1px dashed rgba(255,255,255,0.2)", animation: "spinz 22s linear infinite reverse" }} />
                <span style={{ width: 58, height: 58, borderRadius: 18, display: "grid", placeItems: "center", background: "#0A0A0B", border: "1px solid rgba(255,255,255,0.16)", boxShadow: `0 0 46px -8px ${tone}`, transform: "rotate(45deg)" }}>
                  <Icon d={AGENT_META[cur]?.sig ?? P.Agents} size={26} color={tone} sw={1.5} style={{ transform: "rotate(-45deg)" }} />
                </span>
              </div>
              <div style={{ flexGrow: 1, minWidth: 220 }}>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{a.name}</h2>
                  <span className="stat">
                    <i />
                    {a.role}
                  </span>
                  <span className="stat">
                    <i className="w" />
                    Engine · {engineLabel(a.engine)}
                  </span>
                </div>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
                  {ABOUT[cur]?.[0]}.
                </p>
              </div>
            </div>
            <div role="tablist" style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 20, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
              <span aria-hidden="true" style={{ position: "absolute", bottom: -1, height: 2, width: "33.333%", left: `${["chat", "about", "settings"].indexOf(tab) * 33.333}%`, background: "#FF2B3A", boxShadow: "0 0 12px #FF2B3A", transition: "left .45s cubic-bezier(.7,0,.2,1)" }} />
              {(["chat", "about", "settings"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} style={{ height: 46, border: 0, background: "transparent", fontSize: 13, fontWeight: 600, color: tab === t ? "#fff" : "#A1A1AA", transition: "color .3s", textTransform: "capitalize" }}>
                  {t}
                </button>
              ))}
            </div>

            {tab === "chat" && (
              <div className="tx-rise" style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 18, flexGrow: 1 }}>
                <div ref={feedRef} className="scroll" style={{ display: "flex", flexDirection: "column", gap: 14, minHeight: 280, maxHeight: 520 }}>
                  {!msgs.length && <div className="muted" style={{ fontSize: 14 }}>Say hi to {a.name}. Conversations are saved on this computer.</div>}
                  {msgs.map((m, i) =>
                    m.role === "user" ? (
                      <div key={i} className="bubble-me">
                        {m.content}
                      </div>
                    ) : (
                      <div key={i} style={{ display: "flex", gap: 12, maxWidth: "92%" }}>
                        <Sigil id={cur} size={30} glow={false} />
                        <div style={{ minWidth: 0 }}>
                          {m.tools?.map((t, j) => (
                            <div key={j} className="mono" style={{ fontSize: 11, color: "#FF5A66", marginBottom: 4 }}>
                              ▸ {t}
                            </div>
                          ))}
                          <div className="bubble-ai" style={{ borderColor: m.error ? "rgba(255,43,58,0.5)" : undefined, color: m.error ? "#FF8A93" : undefined }}>
                            {m.content ? <Md text={m.content} /> : <span className="dots3"><span /><span /><span /></span>}
                          </div>
                          {(m.model || m.engine) && <div className="mono" style={{ fontSize: 10, color: "#71717A", marginTop: 4 }}>{m.engine} {m.model ? `· ${m.model}` : ""}</div>}
                        </div>
                      </div>
                    ),
                  )}
                </div>
                {a.engine !== "claude" && a.id === "forge" && (
                  <div className="row" style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid rgba(255,43,58,0.35)", background: "rgba(255,43,58,0.06)", fontSize: 12, color: "#D4D4D8" }}>
                    <Icon d={P.terminal} size={16} color="#FF2B3A" />
                    {state.engines.claudeCode.ok ? "Code requests run through Claude Code in your playground project." : "Install Claude Code to let Forge edit real files — until then Forge answers through Claude."}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10 }}>
                  <label className="sr" htmlFor="agent-msg">
                    Message {a.name}
                  </label>
                  <input id="agent-msg" className="field" style={{ flexGrow: 1, height: 50 }} placeholder={`Message ${a.name}…`} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), send())} />
                  {busy ? (
                    <button type="button" className="btn" aria-label="Stop" style={{ width: 50, height: 50, padding: 0 }} onClick={() => (abortRef.current(), setBusy(false))}>
                      <Icon d="M7 7h10v10H7z" size={16} />
                    </button>
                  ) : (
                    <button type="button" className="btn btn-red" data-sfx="none" aria-label="Send" style={{ width: 50, height: 50, padding: 0 }} onClick={send}>
                      <Icon d={P.send} size={18} sw={2.2} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {tab === "about" && (
              <div className="tx-flip" style={{ paddingTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
                {(ABOUT[cur] ?? []).map((t, i) => (
                  <div key={t} className="card rise" style={{ padding: "13px 16px", borderRadius: 14, fontSize: 14, animationDelay: `${i * 0.07}s` }}>
                    <span className="mono" style={{ color: "#FF2B3A", marginRight: 10, fontSize: 11 }}>
                      0{i + 1}
                    </span>
                    {t}
                  </div>
                ))}
                <p className="muted" style={{ fontSize: 12, margin: "6px 0 0" }}>
                  {a.messages} messages saved · stored only on this computer
                </p>
              </div>
            )}

            {tab === "settings" && (
              <div className="tx-blinds" style={{ paddingTop: 18, display: "flex", flexDirection: "column", gap: 18 }}>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
                    Engine
                  </div>
                  <Seg label="Engine" value={a.engine} onChange={(e) => void save({ engine: e })} width={440} options={[["auto", "Auto"], ["claude", "Claude"], ["code", "Claude Code"], ["local", "Local"]]} />
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
                    {a.engine === "code" ? "Claude Code works inside your playground project — edits files and runs safe commands." : a.engine === "local" ? "Uses your local model from Settings → Engines." : a.engine === "auto" ? "Auto: Claude Code for repo work when installed, Claude for everything else." : "Claude in the cloud, with automatic fallback across models."}
                  </p>
                </div>
                <div>
                  <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>
                    Autonomy
                  </div>
                  <Seg label="Autonomy" value={a.autonomy} onChange={(v) => void save({ autonomy: v })} width={360} options={[["ask", "Ask first"], ["spend", "Ask > $20"], ["full", "Full auto"]]} />
                </div>
                <div className="row" style={{ fontSize: 14 }}>
                  <span style={{ flexGrow: 1 }}>Show in the Command center</span>
                  <Switch on={a.enabled} label={`Enable ${a.name}`} onChange={(v) => void save({ enabled: v })} />
                </div>
                <button type="button" className="btn" style={{ alignSelf: "flex-start", borderColor: "rgba(255,43,58,0.45)", color: "#FF5A66" }} onClick={clear}>
                  Clear chat history
                </button>
              </div>
            )}
          </>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div className="card rise d4" style={{ padding: 18 }}>
          <h2 className="disp" style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 400 }}>
            Recent
          </h2>
          {agents
            .filter((x) => x.last)
            .slice(0, 6)
            .map((x) => (
              <button key={x.id} type="button" className="listbtn" onClick={() => (setCur(x.id), setTab("chat"))} style={{ alignItems: "flex-start", padding: "8px 6px" }}>
                <Sigil id={x.id} size={28} glow={false} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{x.name}</span>
                  <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12, color: "#A1A1AA" }}>{x.last}</span>
                </span>
              </button>
            ))}
          {!agents.some((x) => x.last) && <div className="muted" style={{ fontSize: 13 }}>No conversations yet.</div>}
        </div>
        <div className="card hot rise d5" style={{ padding: 18, fontSize: 13, lineHeight: 1.6 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Icon d={P.Command} size={16} color="#FF2B3A" />
            <b>Want them to work together?</b>
          </div>
          <span className="muted">Select several agents in the Command center — they’ll answer in turn, build on each other, and Atlas sums it up.</span>
          <a href="#/command" className="btn" style={{ marginTop: 12, width: "100%" }}>
            Open Command center
          </a>
        </div>
      </section>
    </div>
  );
}
