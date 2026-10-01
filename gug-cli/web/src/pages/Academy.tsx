import { useEffect, useState } from "react";
import { useApp } from "../App";
import { PLAYBOOKS } from "../playbooks";
import { Icon, P, Seg } from "../ui";

const CATS: [string, string][] = [["all", "All"], ["commerce", "Commerce"], ["investing", "Investing"], ["creator", "Creator"], ["automation", "Automation"]];

export function Academy() {
  const { go } = useApp();
  const [cat, setCat] = useState("all");
  const [sel, setSel] = useState(() => localStorage.getItem("gug-playbook") ?? "drop");
  const [prog, setProg] = useState<Record<string, number[]>>(() => JSON.parse(localStorage.getItem("gug-progress") ?? "{}"));
  useEffect(() => localStorage.setItem("gug-progress", JSON.stringify(prog)), [prog]);
  useEffect(() => localStorage.setItem("gug-playbook", sel), [sel]);

  const list = PLAYBOOKS.filter((g) => cat === "all" || g.cat === cat);
  const g = PLAYBOOKS.find((x) => x.id === sel) ?? PLAYBOOKS[0];
  const done = prog[g.id] ?? [];
  const pct = (id: string) => {
    const pb = PLAYBOOKS.find((x) => x.id === id)!;
    return Math.round((100 * (prog[id]?.length ?? 0)) / pb.steps.length);
  };
  const toggle = (i: number) => setProg((p) => ({ ...p, [g.id]: done.includes(i) ? done.filter((x) => x !== i) : [...done, i] }));
  const run = () => {
    const next = g.steps.find((_, i) => !done.includes(i)) ?? g.steps[0];
    localStorage.setItem("gug-sel", JSON.stringify(["atlas", ...g.agentIds].slice(0, 4)));
    localStorage.setItem("gug-prefill", `We're working through the "${g.title}" playbook. Next step: ${next} Help me do this step — be concrete and ask me anything you need.`);
    go("command");
  };
  const p = pct(g.id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="rise d2 row" style={{ flexWrap: "wrap", gap: 14 }}>
        <Seg label="Category" value={cat} onChange={setCat} width={560} options={CATS} />
        <span className="mono muted" style={{ fontSize: 11 }}>HOVER A CARD TO FLIP IT</span>
      </div>
      <div className="g2r" style={{ gridTemplateColumns: "minmax(0,1fr) 420px" }}>
        <section key={cat} className="tx-blinds" style={{ minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16, alignContent: "start" }}>
          {list.map((c, i) => (
            <button key={c.id} type="button" className="flip rise" aria-label={`Open playbook: ${c.title}`} onClick={() => setSel(c.id)} style={{ height: 236, animationDelay: `${i * 0.05}s` }}>
              <span className="flip-in" style={{ display: "block" }}>
                <span className="face card" style={{ display: "flex", flexDirection: "column", padding: 20, borderColor: c.id === sel ? "rgba(255,43,58,0.6)" : undefined, boxShadow: c.id === sel ? "0 0 0 1px rgba(255,43,58,0.35), 0 30px 60px -30px rgba(255,43,58,0.5)" : undefined }}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span className="disp" style={{ fontSize: 34, fontWeight: 300, color: "transparent", WebkitTextStroke: "1px rgba(255,255,255,0.5)" }}>{c.n}</span>
                    <span className="eyebrow" style={{ fontSize: 10 }}>{c.catL}</span>
                  </span>
                  <span className="disp" style={{ display: "block", marginTop: 14, fontSize: 17, fontWeight: 400, lineHeight: 1.25 }}>{c.title}</span>
                  <span style={{ display: "block", marginTop: 6, fontSize: 13, color: "#A1A1AA", lineHeight: 1.45 }}>{c.sub}</span>
                  <span style={{ flexGrow: 1 }} />
                  <span className="row" style={{ fontSize: 11 }}>
                    <span className="chip" style={{ height: 24, fontSize: 11 }}>{c.level}</span>
                    <span className="mono muted" style={{ marginLeft: "auto" }}>{pct(c.id)}%</span>
                  </span>
                  <span style={{ display: "block", height: 3, marginTop: 10, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
                    <span style={{ display: "block", height: "100%", width: `${pct(c.id)}%`, borderRadius: 3, background: "#FF2B3A", boxShadow: "0 0 8px #FF2B3A", transition: "width .6s" }} />
                  </span>
                </span>
                <span className="face back card hot" style={{ display: "flex", flexDirection: "column", padding: 20, background: "linear-gradient(160deg, #1A0306, #070707)" }}>
                  <span className="eyebrow" style={{ fontSize: 10, color: "#FF5A66" }}>You’ll do</span>
                  {c.steps.slice(0, 3).map((s) => (
                    <span key={s} style={{ display: "block", marginTop: 10, fontSize: 12, lineHeight: 1.45, color: "#D4D4D8" }}>— {s}</span>
                  ))}
                  <span style={{ flexGrow: 1 }} />
                  <span className="row" style={{ justifyContent: "space-between", fontSize: 12 }}>
                    <span className="mono muted">{c.agents}</span>
                    <span className="row" style={{ gap: 6, fontWeight: 600 }}>Open <Icon d={P.arrow} size={14} /></span>
                  </span>
                </span>
              </span>
            </button>
          ))}
        </section>
        <section className="card rise d4" style={{ padding: 22, alignSelf: "start" }}>
          <div key={g.id} className="tx-flip">
            <div className="eyebrow">
              <span style={{ color: "#FF2B3A" }}>{g.n}</span> — {g.catL} playbook
            </div>
            <div className="row" style={{ gap: 18, marginTop: 14 }}>
              <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
                <svg width="96" height="96" viewBox="0 0 96 96" aria-hidden="true">
                  <circle cx="48" cy="48" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
                  <circle cx="48" cy="48" r="42" fill="none" stroke="#FF2B3A" strokeWidth="5" strokeLinecap="round" strokeDasharray="264" strokeDashoffset={264 - (264 * p) / 100} transform="rotate(-90 48 48)" style={{ transition: "stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)", filter: "drop-shadow(0 0 6px #FF2B3A)" }} />
                </svg>
                <span className="disp" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 17, fontWeight: 300 }}>{p}%</span>
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 className="disp" style={{ margin: 0, fontSize: 22, fontWeight: 300, lineHeight: 1.2 }}>{g.title}</h2>
                <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>{g.sub}</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
              <span className="chip">{g.time}</span>
              <span className="chip">{g.level}</span>
              <span className="chip">{g.agents}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 18 }}>
              {g.steps.map((s, i) => {
                const on = done.includes(i);
                return (
                  <button key={s} type="button" className="listbtn" aria-pressed={on} onClick={() => toggle(i)} style={{ alignItems: "flex-start", padding: 10, minHeight: 0 }}>
                    <span style={{ flexShrink: 0, width: 20, height: 20, marginTop: 1, borderRadius: 6, border: `1.5px solid ${on ? "#FF2B3A" : "rgba(255,255,255,0.25)"}`, background: on ? "#FF2B3A" : "transparent", display: "grid", placeItems: "center", transition: "all .3s" }}>
                      {on && <Icon d={P.check} size={12} sw={3} color="#fff" />}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: "#FF2B3A", marginTop: 3 }}>{String(i + 1).padStart(2, "0")}</span>
                    <span style={{ fontSize: 13, lineHeight: 1.5, color: on ? "#71717A" : "#F4F4F5", textDecoration: on ? "line-through" : "none", transition: "color .3s" }}>{s}</span>
                  </button>
                );
              })}
            </div>
            <div className="row" style={{ alignItems: "flex-start", gap: 12, marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid rgba(255,43,58,0.35)", background: "rgba(255,43,58,0.06)" }}>
              <Icon d={P.alert} size={20} color="#FF2B3A" />
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em" }}>READ BEFORE YOU START</div>
                <p style={{ margin: "4px 0 0", fontSize: 12, lineHeight: 1.55, color: "#D4D4D8" }}>{g.risk}</p>
              </div>
            </div>
            <button type="button" className="btn btn-red" style={{ width: "100%", marginTop: 16 }} onClick={run}>
              <Icon d={P.play} size={15} />
              Run the next step with agents
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
