import { useEffect, useRef, useState } from "react";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { Md } from "../Md";
import { play } from "../sfx";
import { Icon, P, Seg, Sigil, Switch } from "../ui";

type Trigger = { type: "manual" } | { type: "every"; minutes: number } | { type: "daily"; at: string };
interface Step { agent: string; prompt: string }
interface Run { at: string; ok: boolean; ms: number; output: string; trigger: string }
interface Flow { id: string; name: string; enabled: boolean; trigger: Trigger; steps: Step[]; deliver: { inbox: boolean; discord: boolean }; lastRunAt?: string; runs: Run[] }
type Draft = Omit<Flow, "id" | "runs"> & { id?: string; runs?: Run[] };
interface Inbox { id: string; flowId: string; title: string; body: string; at: string; read: boolean }

const AGENTS = ["atlas", "ledger", "quant", "muse", "echo", "relay", "scout", "forge", "vox", "tempo", "sage", "sentinel"];
const NAME = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);
const blank = (): Draft => ({ name: "New flow", enabled: true, trigger: { type: "manual" }, steps: [{ agent: "atlas", prompt: "" }], deliver: { inbox: true, discord: false } });
const describe = (t: Trigger) => (t.type === "daily" ? `Every day at ${t.at}` : t.type === "every" ? `Every ${t.minutes >= 60 ? `${t.minutes / 60} h` : `${t.minutes} min`}` : "When you press Run");
const ago = (iso?: string) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export function Flows() {
  const { toast, state } = useApp();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [templates, setTemplates] = useState<Draft[]>([]);
  const [inbox, setInbox] = useState<Inbox[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [log, setLog] = useState<{ step?: number; text: string; kind: "text" | "info" | "error" }[]>([]);
  const [running, setRunning] = useState(false);
  const [openItem, setOpenItem] = useState<string | null>(null);
  const abortRef = useRef<() => void>(() => {});

  const load = async () => {
    const r = await api<{ flows: Flow[]; templates: Draft[]; inbox: Inbox[] }>("/api/flows");
    setFlows(r.flows);
    setTemplates(r.templates);
    setInbox(r.inbox);
    return r;
  };
  useEffect(() => {
    void load().then((r) => setDraft(r.flows[0] ? structuredClone(r.flows[0]) : null));
    return () => abortRef.current();
  }, []);

  const save = async () => {
    if (!draft) return;
    try {
      const saved = await api<Flow>(draft.id ? `/api/flows/${draft.id}` : "/api/flows", { method: draft.id ? "PUT" : "POST", body: draft });
      await load();
      setDraft(structuredClone(saved));
      toast("Flow saved.");
      return saved;
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const remove = async () => {
    if (!draft?.id || !confirm(`Delete “${draft.name}”?`)) return;
    await api(`/api/flows/${draft.id}`, { method: "DELETE" });
    const r = await load();
    setDraft(r.flows[0] ? structuredClone(r.flows[0]) : null);
  };

  const toggle = async (f: Flow, enabled: boolean) => {
    await api(`/api/flows/${f.id}`, { method: "PUT", body: { ...f, enabled } });
    await load();
    if (draft?.id === f.id) setDraft({ ...draft, enabled });
  };

  const run = async () => {
    const saved = await save();
    if (!saved) return;
    play("send");
    setRunning(true);
    setLog([{ kind: "info", text: `Running “${saved.name}”…` }]);
    abortRef.current = stream(`/api/flows/${saved.id}/run`, {}, (ev: GugEvent & { step?: number }) => {
      setLog((l) => {
        const out = [...l];
        const last = out[out.length - 1];
        if (ev.type === "start") out.push({ kind: "info", step: ev.step, text: `Step ${(ev.step ?? 0) + 1} · ${NAME(ev.agent ?? "")} · ${ev.model ?? ""}` });
        else if (ev.type === "text") {
          if (last?.kind === "text" && last.step === ev.step) out[out.length - 1] = { ...last, text: last.text + ev.text };
          else out.push({ kind: "text", step: ev.step, text: ev.text });
        } else if (ev.type === "tool") out.push({ kind: "info", text: `${ev.name}: ${ev.detail}` });
        else if (ev.type === "fallback") out.push({ kind: "info", text: `Router: ${ev.from} → ${ev.to ?? "next"}` });
        else if (ev.type === "error") out.push({ kind: "error", text: ev.message });
        return out;
      });
    }, async () => {
      setRunning(false);
      play("success");
      const r = await load();
      const fresh = r.flows.find((x) => x.id === saved.id);
      if (fresh) setDraft((d) => (d ? { ...d, runs: fresh.runs, lastRunAt: fresh.lastRunAt } : d));
    });
  };

  const setStep = (i: number, patch: Partial<Step>) => draft && setDraft({ ...draft, steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const unread = inbox.filter((i) => !i.read).length;

  return (
    <div className="g3 cols" style={{ ["--cols" as string]: "280px minmax(0,1fr) 340px" }}>
      <section className="card rise d2" style={{ padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4, alignSelf: "start" }}>
        <div className="row" style={{ padding: "0 8px 8px" }}>
          <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Your flows</h2>
          <button type="button" className="btn iconbtn" aria-label="New flow" style={{ width: 34, height: 34 }} onClick={() => setDraft(blank())}>
            <Icon d={P.plus} size={15} />
          </button>
        </div>
        {flows.map((f) => (
          <div key={f.id} className="row" style={{ gap: 8, paddingRight: 10, borderRadius: 14, border: `1px solid ${draft?.id === f.id ? "rgba(255,255,255,0.1)" : "transparent"}`, background: draft?.id === f.id ? "rgba(255,255,255,0.06)" : undefined, transition: "all .3s" }}>
            <button type="button" data-sfx="tab" className="listbtn" style={{ flexGrow: 1, minWidth: 0, minHeight: 62 }} onClick={() => setDraft(structuredClone(f))}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{f.name}</span>
                <span className="muted" style={{ display: "block", fontSize: 11 }}>{describe(f.trigger)}</span>
                <span className="mono" style={{ display: "block", fontSize: 10, color: "#71717A", marginTop: 3 }}>last run {ago(f.lastRunAt)}</span>
              </span>
            </button>
            <Switch on={f.enabled} label={`Turn ${f.name} on or off`} onChange={(v) => void toggle(f, v)} />
          </div>
        ))}
        {!flows.length && <div className="muted" style={{ fontSize: 13, padding: "4px 8px" }}>No flows yet. Start from a template:</div>}
        <div className="eyebrow" style={{ fontSize: 10, padding: "14px 8px 6px" }}>Templates</div>
        {templates.map((t) => (
          <button key={t.name} type="button" className="listbtn" style={{ minHeight: 44, fontSize: 13 }} onClick={() => (setDraft(structuredClone({ ...t, enabled: true })), play("tab"))}>
            <Icon d={P.plus} size={13} color="#FF2B3A" />
            <span style={{ flexGrow: 1 }}>{t.name}</span>
            <span className="mono muted" style={{ fontSize: 10 }}>{t.steps.map((s) => NAME(s.agent)).join(" → ")}</span>
          </button>
        ))}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        {!draft ? (
          <div className="card rise d3" style={{ padding: 40, textAlign: "center" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Automate the boring bits</h2>
            <p className="muted" style={{ fontSize: 14 }}>A flow runs one or more agents on a schedule and drops the result in your inbox or Discord.</p>
            <button type="button" className="btn btn-red" onClick={() => setDraft(blank())}>New flow</button>
          </div>
        ) : (
          <div key={draft.id ?? "new"} className="tx-wipe" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              <div className="row" style={{ padding: "14px 18px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
                <label className="sr" htmlFor="flow-name">Flow name</label>
                <input id="flow-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} style={{ flexGrow: 1, border: 0, outline: 0, background: "transparent", fontSize: 17, fontWeight: 600, color: "#F4F4F5" }} />
                <span className="mono" style={{ fontSize: 10, letterSpacing: ".14em", color: draft.enabled ? "#FF2B3A" : "#71717A" }}>● {draft.enabled ? "ON" : "OFF"}</span>
              </div>
              {/* the chain */}
              <div style={{ overflowX: "auto", backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "22px 22px", padding: "26px 20px" }}>
                <div className="row" style={{ gap: 0, alignItems: "stretch", minWidth: "max-content" }}>
                  <Node kind="TRIGGER" title={describe(draft.trigger)} sub={draft.trigger.type === "manual" ? "Run button" : "Scheduler"} red />
                  {draft.steps.map((s, i) => (
                    <div key={i} className="row" style={{ gap: 0 }}>
                      <Wire />
                      <Node kind={`STEP ${i + 1} · ${NAME(s.agent).toUpperCase()}`} title={s.prompt ? s.prompt.slice(0, 48) + (s.prompt.length > 48 ? "…" : "") : "Write instructions"} sub={i ? "sees the step before" : "starts the chain"} agent={s.agent} />
                    </div>
                  ))}
                  <Wire />
                  <Node kind="DELIVER" title={[draft.deliver.inbox && "Inbox", draft.deliver.discord && "Discord"].filter(Boolean).join(" + ") || "Nowhere yet"} sub="where the result goes" red />
                </div>
              </div>
            </div>

            <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
              <div>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>When</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
                  <Seg label="Trigger" value={draft.trigger.type} width={330} options={[["manual", "Manual"], ["daily", "Daily"], ["every", "Repeat"]]} onChange={(t) => setDraft({ ...draft, trigger: t === "daily" ? { type: "daily", at: "08:00" } : t === "every" ? { type: "every", minutes: 60 } : { type: "manual" } })} />
                  {draft.trigger.type === "daily" && <input aria-label="Time" type="time" className="field" value={draft.trigger.at} onChange={(e) => setDraft({ ...draft, trigger: { type: "daily", at: e.target.value } })} style={{ width: 130 }} />}
                  {draft.trigger.type === "every" && (
                    <select aria-label="Interval" className="field" value={draft.trigger.minutes} onChange={(e) => setDraft({ ...draft, trigger: { type: "every", minutes: Number(e.target.value) } })} style={{ width: 160 }}>
                      {[15, 30, 60, 120, 240, 720, 1440].map((m) => <option key={m} value={m}>{m >= 60 ? `every ${m / 60} h` : `every ${m} min`}</option>)}
                    </select>
                  )}
                </div>
                {draft.trigger.type !== "manual" && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>Scheduled flows run while <span className="mono">gug serve</span> is running.</p>}
              </div>
              <div>
                <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Steps</div>
                {draft.steps.map((s, i) => (
                  <div key={i} className="card" style={{ padding: 14, marginBottom: 10, display: "flex", gap: 12 }}>
                    <Sigil id={s.agent} size={34} glow={false} />
                    <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                      <div className="row">
                        <select aria-label={`Agent for step ${i + 1}`} className="field" value={s.agent} onChange={(e) => setStep(i, { agent: e.target.value })} style={{ height: 36, width: 160 }}>
                          {AGENTS.map((a) => <option key={a} value={a}>{NAME(a)}</option>)}
                        </select>
                        <span style={{ flexGrow: 1 }} />
                        {draft.steps.length > 1 && (
                          <button type="button" className="chip" aria-label={`Remove step ${i + 1}`} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, j) => j !== i) })}>
                            <Icon d={P.x} size={12} /> Remove
                          </button>
                        )}
                      </div>
                      <textarea aria-label={`Instructions for step ${i + 1}`} className="field" rows={3} value={s.prompt} onChange={(e) => setStep(i, { prompt: e.target.value })} placeholder={i ? "e.g. Turn this into 3 tweets: {{previous}}" : "e.g. It's {{date}}. Plan my day in 5 bullets."} />
                    </div>
                  </div>
                ))}
                {draft.steps.length < 5 && (
                  <button type="button" className="chip" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { agent: "echo", prompt: "" }] })}>
                    <Icon d={P.plus} size={12} /> Add a step
                  </button>
                )}
                <p className="muted mono" style={{ fontSize: 11, margin: "10px 0 0" }}>{"{{date}} · {{time}} · {{previous}} work in instructions"}</p>
              </div>
              <div className="row" style={{ flexWrap: "wrap", gap: 18 }}>
                <span className="eyebrow" style={{ fontSize: 10 }}>Deliver to</span>
                <label className="row" style={{ fontSize: 13, gap: 8 }}><Switch on={draft.deliver.inbox} label="Deliver to inbox" onChange={(v) => setDraft({ ...draft, deliver: { ...draft.deliver, inbox: v } })} /> Inbox</label>
                <label className="row" style={{ fontSize: 13, gap: 8 }}><Switch on={draft.deliver.discord} label="Deliver to Discord" onChange={(v) => setDraft({ ...draft, deliver: { ...draft.deliver, discord: v } })} /> Discord</label>
              </div>
              <div className="row" style={{ paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.07)", flexWrap: "wrap" }}>
                {draft.id && <button type="button" className="btn" style={{ borderColor: "rgba(255,43,58,0.45)", color: "#FF5A66" }} onClick={remove}>Delete</button>}
                <span style={{ flexGrow: 1 }} />
                <button type="button" className="btn" onClick={save}>Save</button>
                <button type="button" className="btn btn-red" data-sfx="none" disabled={running || !state.engines.claudeKeys} title={state.engines.claudeKeys ? "" : "Add a Claude key first"} onClick={run}>
                  <Icon d={P.play} size={14} /> {running ? "Running…" : "Save & run now"}
                </button>
              </div>
            </div>

            {log.length > 0 && (
              <div className="card tx-rise" style={{ padding: "16px 18px" }}>
                <h2 className="disp" style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 400 }}>Run log</h2>
                {log.map((l, i) =>
                  l.kind === "text" ? (
                    <div key={i} className="bubble-ai" style={{ margin: "6px 0" }}><Md text={l.text} /></div>
                  ) : (
                    <div key={i} className="mono" style={{ fontSize: 12, color: l.kind === "error" ? "#FF5A66" : "#A1A1AA", margin: "4px 0" }}>
                      <span style={{ color: "#FF2B3A" }}>{l.kind === "error" ? "✖" : "❯"}</span> {l.text}
                    </div>
                  ),
                )}
                {running && <span className="dots3"><span /><span /><span /></span>}
              </div>
            )}
          </div>
        )}
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card hot rise d4" style={{ padding: 18 }}>
          <div className="row" style={{ marginBottom: 10 }}>
            <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Inbox</h2>
            {unread > 0 && <span className="mono" style={{ fontSize: 10, color: "#FF2B3A" }}>{unread} NEW</span>}
            {unread > 0 && <button type="button" className="chip" style={{ height: 26 }} onClick={async () => (await api("/api/inbox/read", { body: {} }), void load())}>Mark read</button>}
          </div>
          {!inbox.length && <div className="muted" style={{ fontSize: 13 }}>Flow results land here.</div>}
          <div className="scroll" style={{ maxHeight: 520 }}>
            {inbox.map((i) => (
              <div key={i.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "10px 0" }}>
                <button type="button" className="row" onClick={() => setOpenItem(openItem === i.id ? null : i.id)} style={{ width: "100%", border: 0, background: "transparent", textAlign: "left", padding: 0 }}>
                  {!i.read && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF2B3A", boxShadow: "0 0 8px #FF2B3A", flexShrink: 0 }} />}
                  <span style={{ flexGrow: 1, fontSize: 13, fontWeight: 600 }}>{i.title}</span>
                  <span className="mono muted" style={{ fontSize: 10 }}>{ago(i.at)}</span>
                </button>
                {openItem === i.id ? (
                  <div className="tx-blinds" style={{ fontSize: 13, marginTop: 8 }}>
                    <Md text={i.body} />
                    <button type="button" className="chip" style={{ marginTop: 8 }} onClick={async () => (await api(`/api/inbox/${i.id}`, { method: "DELETE" }), void load())}>Delete</button>
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 12, marginTop: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{i.body}</div>
                )}
              </div>
            ))}
          </div>
        </div>
        {draft?.runs && draft.runs.length > 0 && (
          <div className="card rise" style={{ padding: 18 }}>
            <h2 className="disp" style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 400 }}>Recent runs</h2>
            {draft.runs.slice(0, 8).map((r) => (
              <div key={r.at} className="row mono" style={{ fontSize: 11, padding: "5px 0" }}>
                <span style={{ color: r.ok ? "#F4F4F5" : "#FF2B3A" }}>{r.ok ? "●" : "✖"}</span>
                <span className="muted" style={{ flexGrow: 1 }}>{new Date(r.at).toLocaleString()}</span>
                <span className="muted">{(r.ms / 1000).toFixed(1)}s · {r.trigger}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Node({ kind, title, sub, red, agent }: { kind: string; title: string; sub: string; red?: boolean; agent?: string }) {
  return (
    <div className="card tilt pop" style={{ width: 190, padding: "13px 15px", borderRadius: 16, flexShrink: 0, borderColor: red ? "rgba(255,43,58,0.5)" : undefined, boxShadow: red ? "0 0 40px -16px rgba(255,43,58,0.8)" : undefined }}>
      <div className="row" style={{ gap: 8 }}>
        {agent && <Sigil id={agent} size={22} glow={false} />}
        <div className="mono" style={{ fontSize: 9, letterSpacing: ".12em", color: red ? "#FF2B3A" : "#A1A1AA" }}>{kind}</div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 8, lineHeight: 1.35 }}>{title}</div>
      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{sub}</div>
    </div>
  );
}

function Wire() {
  return (
    <svg width="46" height="20" viewBox="0 0 46 20" aria-hidden="true" style={{ alignSelf: "center", flexShrink: 0 }}>
      <path className="flow" d="M0 10H40" stroke="#FF2B3A" strokeWidth="1.6" fill="none" />
      <path d="M36 5l6 5-6 5" fill="none" stroke="#FF2B3A" strokeWidth="1.6" />
      <circle r="2.6" fill="#fff">
        <animateMotion dur="1.4s" repeatCount="indefinite" path="M0 10H40" />
      </circle>
    </svg>
  );
}
