import { useState } from "react";
import { api, type Engine } from "../api";
import { useApp } from "../App";
import { play } from "../sfx";
import { AGENT_META, Brand, Icon, P, Seg, Sigil } from "../ui";

const STEPS = ["Choose engines", "Get access", "Test & save", "Pick an AI", "First job"];
const TEMPLATES: [string, string, string][] = [
  ["atlas", "Atlas", "Orchestrator"], ["ledger", "Ledger", "Finance"], ["quant", "Quant", "Markets"], ["muse", "Muse", "Creative"],
  ["echo", "Echo", "Marketing"], ["relay", "Relay", "Automations"], ["scout", "Scout", "Research"], ["forge", "Forge", "Code"],
  ["vox", "Vox", "Voice"], ["tempo", "Tempo", "Calendar"], ["sage", "Sage", "Tutor"], ["sentinel", "Sentinel", "Security"],
];
const FAQ: [string, string][] = [
  ["What is an API key?", "A private password that lets GUG-cli use an AI on your account. You create it on the provider’s website, paste it once, and it’s stored encrypted on this computer."],
  ["Claude or Claude Code — which do I need?", "Claude (the API) is for thinking, writing, research and planning. Claude Code is an agent that works inside a project folder: it edits files, runs tests and more. Most people set up both and let Auto choose."],
  ["How much will it cost?", "You pay the provider directly for what you use, usually cents per conversation. Set a monthly limit in the Claude Console. Local models are free."],
  ["What happens if I hit a limit?", "The router hands the job to the next model in the chain — Opus 5.5 → Sonnet 5.5 → Haiku 4.5 — and rotates through your backup keys, usually in under a second."],
  ["Where are my keys stored?", "On this computer, encrypted, in the GUG-cli data folder. They’re only ever sent to the provider they belong to."],
  ["Can I add an AI that isn’t listed?", "v1 ships with 12 specialist AIs you can point at any engine. Custom AIs with your own instructions are next on the roadmap."],
];

function Cmd({ c }: { c: string }) {
  const { toast } = useApp();
  return (
    <div className="row" style={{ padding: "10px 12px", borderRadius: 10, background: "#050505", border: "1px solid rgba(255,255,255,0.1)", marginTop: 8 }}>
      <span className="mono" style={{ color: "#FF2B3A" }}>❯</span>
      <code className="mono" style={{ flexGrow: 1, fontSize: 13 }}>{c}</code>
      <button type="button" className="btn iconbtn" aria-label="Copy command" style={{ width: 32, height: 32 }} onClick={() => navigator.clipboard?.writeText(c).then(() => toast("Copied."))}>
        <Icon d={P.copy} size={14} />
      </button>
    </div>
  );
}

function Numbered({ items }: { items: React.ReactNode[] }) {
  return (
    <>
      {items.map((t, i) => (
        <div key={i} className="rise" style={{ display: "flex", gap: 14, padding: "10px 0", animationDelay: `${0.05 + i * 0.08}s` }}>
          <span className="mono" style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, display: "grid", placeItems: "center", fontSize: 11, background: "#FF2B3A" }}>{i + 1}</span>
          <div style={{ flexGrow: 1, fontSize: 14, lineHeight: 1.6 }}>{t}</div>
        </div>
      ))}
    </>
  );
}

export function Guide() {
  const { state, refresh, go } = useApp();
  const [step, setStep] = useState(1);
  const [gtab, setGtab] = useState<"claude" | "code" | "local">("claude");
  const [key, setKey] = useState("");
  const [test, setTest] = useState<{ state: "idle" | "busy" | "ok" | "err"; msg?: string }>({ state: "idle" });
  const [shake, setShake] = useState(0);
  const [tpl, setTpl] = useState("forge");
  const [aeng, setAeng] = useState<Engine>("auto");
  const [job, setJob] = useState("");
  const [open, setOpen] = useState(0);

  const runTest = async () => {
    setTest({ state: "busy" });
    try {
      const r = await api<{ ok: boolean; message: string }>("/api/vault/test-claude", { body: { key: key.trim() } });
      if (!r.ok) throw new Error(r.message);
      await api("/api/vault/anthropic", { method: "PUT", body: { value: key.trim() } });
      await refresh();
      setKey("");
      play("success");
      setTest({ state: "ok", msg: r.message });
    } catch (e) {
      play("error");
      setShake((s) => s + 1);
      setTest({ state: "err", msg: (e as Error).message });
    }
  };

  const launch = async () => {
    await api("/api/prefs", { method: "PATCH", body: { agents: { [tpl]: { engine: aeng, enabled: true } } } });
    localStorage.setItem("gug-agent", tpl);
    if (job.trim()) localStorage.setItem("gug-prefill", job.trim());
    play("boot");
    go("agents");
  };

  const t = TEMPLATES.find((x) => x[0] === tpl)!;
  const tone = AGENT_META[tpl]?.tone ?? "#F4F4F5";
  const engineReady = { claude: state.engines.claudeKeys > 0, code: state.engines.claudeCode.ok, local: state.engines.local };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="card rise d2" style={{ padding: "22px 26px" }}>
        <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
          <span aria-hidden="true" style={{ position: "absolute", left: "10%", right: "10%", top: 19, height: 2, background: "rgba(255,255,255,0.08)" }}>
            <span style={{ display: "block", height: "100%", width: `${((step - 1) / 4) * 100}%`, background: "#FF2B3A", boxShadow: "0 0 10px #FF2B3A", transition: "width .7s cubic-bezier(.7,0,.2,1)" }} />
          </span>
          {STEPS.map((label, i) => {
            const n = i + 1;
            return (
              <button key={label} type="button" data-sfx="tab" aria-current={step === n} onClick={() => setStep(n)} style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, border: 0, background: "transparent", padding: 0 }}>
                <span className="mono" style={{ width: 40, height: 40, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 13, border: `1.5px solid ${step >= n ? "#FF2B3A" : "rgba(255,255,255,0.18)"}`, background: step > n ? "#FF2B3A" : step === n ? "rgba(255,43,58,0.15)" : "#0A0A0B", boxShadow: step === n ? "0 0 0 6px rgba(255,43,58,0.12), 0 0 24px rgba(255,43,58,0.6)" : "none", color: "#fff", transition: "all .5s cubic-bezier(.2,.8,.2,1)" }}>
                  {step > n ? <Icon d={P.check} size={15} sw={3} color="#fff" /> : n}
                </span>
                <span style={{ fontSize: 12, fontWeight: 600, color: step >= n ? "#F4F4F5" : "#71717A" }}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="g2r" style={{ gridTemplateColumns: "minmax(0,1fr) 400px" }}>
        <section className="card rise d3" style={{ padding: 28, minHeight: 520, display: "flex", flexDirection: "column" }}>
          <div style={{ flexGrow: 1 }}>
            {step === 1 && (
              <div className="tx-slide">
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Which AIs will you use?</h2>
                <p className="muted" style={{ margin: "6px 0 18px", fontSize: 14 }}>You can use all three. Here’s what each is for and whether it’s ready on this computer.</p>
                <div className="k3" style={{ gap: 14 }}>
                  {([["anthropic", "Claude API", "Chat, planning, writing and research. Needs an API key.", "claude", "red"], ["claudecode", "Claude Code", "Works inside your projects: edits files and runs tests. Best for building.", "code", "tint"], ["local", "Local model", "Free and private via Ollama or LM Studio. Optional.", "local", ""]] as const).map(([b, n, d, k, v]) => (
                    <div key={n} className="card tilt" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, borderColor: engineReady[k] ? "rgba(255,43,58,0.5)" : undefined }}>
                      <Brand name={b} size={44} variant={v} />
                      <div style={{ fontSize: 15, fontWeight: 600 }}>{n}</div>
                      <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>{d}</p>
                      <span className="mono" style={{ fontSize: 10, letterSpacing: ".1em", color: engineReady[k] ? "#FF5A66" : "#71717A" }}>{engineReady[k] ? "● READY" : "○ NOT SET UP"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="tx-flip">
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Get access</h2>
                <p className="muted" style={{ margin: "6px 0 16px", fontSize: 14 }}>Follow the steps for each engine you want.</p>
                <Seg label="Engine" value={gtab} onChange={setGtab} width={380} options={[["claude", "Claude API"], ["code", "Claude Code"], ["local", "Local"]]} />
                <div key={gtab} className="tx-wipe" style={{ marginTop: 16 }}>
                  {gtab === "claude" && (
                    <Numbered items={[
                      <>Open the Claude Console at <a href="https://platform.claude.com" target="_blank" rel="noopener">platform.claude.com</a> and sign in.</>,
                      <>Go to <b>API keys</b> → <b>Create key</b>. Name it “GUG-cli”.</>,
                      <>Copy the key — it starts with <span className="mono">sk-ant-</span>. You only see it once.</>,
                      <>Optional: set a monthly spend limit in the Console as a safety net.</>,
                    ]} />
                  )}
                  {gtab === "code" && (
                    <Numbered items={[
                      <>Install Claude Code (needs Node 18+):<Cmd c="npm install -g @anthropic-ai/claude-code" /></>,
                      <>Run it once and sign in with your Claude plan or an API key:<Cmd c="claude" /></>,
                      <>Restart <span className="mono">gug serve</span>. GUG-cli finds it automatically — Forge uses it for code.</>,
                    ]} />
                  )}
                  {gtab === "local" && (
                    <Numbered items={[
                      <>Install <a href="https://ollama.com" target="_blank" rel="noopener">Ollama</a> (or LM Studio).</>,
                      <>Download a model:<Cmd c="ollama pull <model-name>" /></>,
                      <>In Apps → Local model, enter the model name. The address is usually <span className="mono">http://127.0.0.1:11434</span>.</>,
                    ]} />
                  )}
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="tx-iris">
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Paste your key and test it</h2>
                <p className="muted" style={{ margin: "6px 0 18px", fontSize: 14 }}>We check it with a free, read-only call before saving. It’s encrypted on this computer.</p>
                <div key={shake} className={shake ? "shake" : ""} style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <label className="sr" htmlFor="api-key">Claude API key</label>
                  <input id="api-key" type="password" className="field mono" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => (setKey(e.target.value), setTest({ state: "idle" }))} onKeyDown={(e) => e.key === "Enter" && runTest()} style={{ flexGrow: 1, minWidth: 240, height: 52 }} />
                  <button type="button" className="btn btn-red" data-sfx="none" disabled={test.state === "busy"} onClick={runTest} style={{ height: 52, padding: "0 24px" }}>
                    <Icon d={P.lock} size={15} />
                    {test.state === "busy" ? "Testing…" : "Test & save"}
                  </button>
                </div>
                <div style={{ marginTop: 18 }}>
                  {state.engines.claudeKeys > 0 && test.state === "idle" && <div className="muted" style={{ fontSize: 13 }}>You already have {state.engines.claudeKeys} key{state.engines.claudeKeys > 1 ? "s" : ""} saved — this would replace the main one.</div>}
                  {test.state === "ok" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {["Key format looks right", `Reached Claude — ${test.msg}`, "Encrypted and saved to your vault"].map((x, i) => (
                        <div key={x} className="rise row" style={{ padding: "10px 14px", borderRadius: 12, background: "#0A0A0B", border: "1px solid rgba(255,255,255,0.08)", animationDelay: `${i * 0.25}s` }}>
                          <span style={{ width: 22, height: 22, borderRadius: "50%", display: "grid", placeItems: "center", background: "#FF2B3A" }}><Icon d={P.check} size={12} sw={3} color="#fff" /></span>
                          <span style={{ fontSize: 14 }}>{x}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {test.state === "err" && (
                    <div className="pop row" style={{ alignItems: "flex-start", padding: 14, borderRadius: 14, border: "1px solid rgba(255,43,58,0.5)", background: "rgba(255,43,58,0.08)" }}>
                      <Icon d={P.alert} size={20} color="#FF2B3A" />
                      <div style={{ fontSize: 13, lineHeight: 1.5 }}>{test.msg}</div>
                    </div>
                  )}
                </div>
              </div>
            )}
            {step === 4 && (
              <div className="tx-zoom">
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Pick an AI to start with</h2>
                <p className="muted" style={{ margin: "6px 0 16px", fontSize: 14 }}>Each one has a clear job. Choose its engine — you can change it later.</p>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 240px", gap: 18 }}>
                  <div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
                      {TEMPLATES.map(([id, name, role]) => (
                        <button key={id} type="button" data-sfx="tab" onClick={() => setTpl(id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: 10, borderRadius: 12, border: `1px solid ${id === tpl ? "rgba(255,43,58,0.6)" : "rgba(255,255,255,0.08)"}`, background: id === tpl ? "rgba(255,43,58,0.14)" : "rgba(255,255,255,0.02)", textAlign: "left", transition: "all .3s" }}>
                          <Sigil id={id} size={26} glow={false} />
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: 12, fontWeight: 600 }}>{name}</span>
                            <span style={{ display: "block", fontSize: 10, color: "#A1A1AA" }}>{role}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Engine</div>
                      <Seg label="Engine" value={aeng} onChange={setAeng} width={420} options={[["auto", "Auto"], ["claude", "Claude"], ["code", "Claude Code"], ["local", "Local"]]} />
                    </div>
                  </div>
                  <div key={tpl} className="card hot pop" style={{ padding: 20, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10 }}>
                    <div className="stage" style={{ width: 110, height: 110, borderRadius: "50%", overflow: "visible" }}>
                      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.14)", borderTopColor: tone, animation: "spinz 10s linear infinite" }} />
                      <Sigil id={tpl} size={60} />
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 600 }}>{t[1]}</div>
                    <div className="mono" style={{ fontSize: 10, color: "#A1A1AA" }}>{t[2].toUpperCase()}</div>
                  </div>
                </div>
              </div>
            )}
            {step === 5 && (
              <div className="tx-drop">
                <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Give {t[1]} its first job</h2>
                <p className="muted" style={{ margin: "6px 0 16px", fontSize: 14 }}>Be specific about the outcome you want.</p>
                <label className="sr" htmlFor="first-job">First job</label>
                <textarea id="first-job" className="field" rows={3} style={{ width: "100%" }} value={job} onChange={(e) => setJob(e.target.value)} placeholder="e.g. Research the top 5 desk products under $30 with good margins" />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                  {["Give me a 3-bullet plan for this week", "Explain how dropshipping margins work, simply", "Build me a pomodoro timer web page"].map((j) => (
                    <button key={j} type="button" className="chip" onClick={() => setJob(j)}>{j}</button>
                  ))}
                </div>
                <button type="button" className="btn btn-red" data-sfx="none" style={{ height: 52, padding: "0 26px", marginTop: 18, fontSize: 14 }} onClick={launch}>
                  <Icon d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" size={16} />
                  Launch {t[1]}
                </button>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 26, paddingTop: 18, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            {step > 1 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
            <span style={{ flexGrow: 1 }} />
            {step < 5 && (
              <button type="button" className="btn btn-white" data-sfx="tab" onClick={() => setStep(step + 1)}>
                Continue <Icon d={P.arrow} size={15} />
              </button>
            )}
          </div>
        </section>

        <section className="card rise d4" style={{ padding: "6px 18px 10px", alignSelf: "start" }}>
          <div className="row" style={{ padding: "14px 0 8px" }}>
            <Sigil id="sage" size={34} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>Questions</div>
              <div className="muted" style={{ fontSize: 11 }}>Answered by Sage</div>
            </div>
          </div>
          {FAQ.map(([q, a], i) => (
            <div key={q} className="acc">
              <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, minHeight: 52, border: 0, background: "transparent", textAlign: "left", fontSize: 14, fontWeight: 600, color: open === i ? "#fff" : "#D4D4D8" }}>
                <span style={{ flexGrow: 1 }}>{q}</span>
                <span style={{ display: "grid", transform: open === i ? "rotate(180deg)" : "none", transition: "transform .35s cubic-bezier(.2,.8,.2,1)" }}>
                  <Icon d={P.down} size={16} />
                </span>
              </button>
              {open === i && <p className="tx-blinds muted" style={{ margin: "0 0 14px", fontSize: 13, lineHeight: 1.6 }}>{a}</p>}
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
