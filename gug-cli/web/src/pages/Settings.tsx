import { useEffect, useRef, useState } from "react";
import { api, type Engine } from "../api";
import { useApp } from "../App";
import { play, setSfx, type Sfx } from "../sfx";
import { Brand, Icon, P, Seg, Switch, useSfxPrefs } from "../ui";

type Section = "keys" | "engines" | "sound" | "data";
const SECTIONS: [Section, string][] = [["keys", "API keys"], ["engines", "Engines"], ["sound", "Sound & motion"], ["data", "Data & alerts"]];

export function Settings() {
  const [sec, setSec] = useState<Section>(() => (localStorage.getItem("gug-settings") as Section) ?? "keys");
  const idx = SECTIONS.findIndex(([s]) => s === sec);
  const pick = (s: Section) => (setSec(s), localStorage.setItem("gug-settings", s));
  return (
    <div className="g2l">
      <nav className="card rise d2" aria-label="Settings sections" style={{ padding: 12, alignSelf: "start", position: "sticky", top: 20 }}>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
          <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, top: idx * 54, height: 50, borderRadius: 14, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", transition: "top .5s cubic-bezier(.7,0,.2,1)" }}>
            <span style={{ position: "absolute", left: -13, top: 12, bottom: 12, width: 3, borderRadius: "0 3px 3px 0", background: "#FF2B3A", boxShadow: "0 0 12px #FF2B3A" }} />
          </span>
          {SECTIONS.map(([s, label], i) => (
            <button key={s} type="button" role="tab" aria-selected={s === sec} className="listbtn" onClick={() => pick(s)} style={{ height: 50, minHeight: 50, color: s === sec ? "#fff" : "#A1A1AA", fontSize: 14, fontWeight: 500, background: "transparent" }}>
              <span className="mono" style={{ fontSize: 10, color: "#71717A" }}>
                0{i + 1}
              </span>
              {label}
            </button>
          ))}
        </div>
      </nav>
      <div className="rise d3" style={{ minWidth: 0 }}>
        {sec === "keys" && <div className="tx-wipe"><Keys /></div>}
        {sec === "engines" && <div className="tx-iris"><Engines /></div>}
        {sec === "sound" && <div className="tx-glitch"><Sound /></div>}
        {sec === "data" && <div className="tx-drop"><Data /></div>}
      </div>
    </div>
  );
}

function Head({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="eyebrow">
        <span style={{ color: "#FF2B3A" }}>{n}</span>
      </div>
      <h2 style={{ margin: "8px 0 0", fontSize: 22, fontWeight: 600 }}>{title}</h2>
      <p className="muted" style={{ margin: "6px 0 0", fontSize: 13, maxWidth: 640, lineHeight: 1.55 }}>
        {sub}
      </p>
    </div>
  );
}

function Keys() {
  const { state, refresh, toast } = useApp();
  const [slot, setSlot] = useState("anthropic");
  const [value, setValue] = useState("");
  const [testing, setTesting] = useState(false);
  const labels: Record<string, string> = { anthropic: "Claude API key", anthropic_2: "Claude API key #2", anthropic_3: "Claude API key #3", github: "GitHub token", github_login: "GitHub username", discord_webhook: "Discord webhook" };

  const save = async () => {
    const v = value.trim();
    if (!v) return;
    setTesting(true);
    try {
      if (slot.startsWith("anthropic")) {
        const r = await api<{ ok: boolean; message: string }>("/api/vault/test-claude", { body: { key: v } });
        if (!r.ok) throw new Error(r.message);
      }
      await api(`/api/vault/${slot}`, { method: "PUT", body: { value: v } });
      setValue("");
      await refresh();
      toast(`${labels[slot] ?? slot} saved and encrypted.`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setTesting(false);
    }
  };

  const remove = async (name: string) => {
    if (!confirm(`Delete ${labels[name] ?? name}?`)) return;
    await api(`/api/vault/${name}`, { method: "DELETE" });
    await refresh();
    toast("Deleted.");
  };

  return (
    <>
      <Head n="01 — API keys" title="Your keys, your vault" sub="Keys are encrypted (AES-256-GCM) on this computer and only ever sent to the provider they belong to. Add more than one Claude key and the router rotates between them when one hits a limit." />
      <div className="card" style={{ padding: "6px 18px" }}>
        {!state.vault.length && <div className="muted" style={{ padding: "16px 0", fontSize: 14 }}>No keys yet. Add your Claude API key below to wake the agents.</div>}
        {state.vault.map((v, i) => (
          <div key={v.name} className="rise" style={{ display: "grid", gridTemplateColumns: "40px minmax(0,1fr) minmax(0,1fr) 90px", gap: 14, alignItems: "center", minHeight: 60, borderTop: i ? "1px solid rgba(255,255,255,0.06)" : undefined, animationDelay: `${i * 0.04}s` }}>
            <Brand name={v.name.startsWith("anthropic") ? "anthropic" : v.name.startsWith("github") ? "github" : v.name.startsWith("discord") ? "discord" : "local"} size={34} variant={v.name.startsWith("anthropic") ? "red" : "tint"} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>{labels[v.name] ?? v.name}</div>
            <span className="mono row" style={{ fontSize: 12, color: "#A1A1AA", gap: 8 }}>
              <Icon d={P.lock} size={13} />
              {v.preview}
            </span>
            <button type="button" className="btn" style={{ height: 36, fontSize: 12 }} onClick={() => remove(v.name)}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="card" style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: 16, marginTop: 14 }}>
        <label className="sr" htmlFor="slot">Which key</label>
        <select id="slot" className="field" style={{ width: 220 }} value={slot} onChange={(e) => setSlot(e.target.value)}>
          <option value="anthropic">Claude API key</option>
          <option value="anthropic_2">Claude API key #2 (backup)</option>
          <option value="anthropic_3">Claude API key #3 (backup)</option>
        </select>
        <label className="sr" htmlFor="newkey">Key</label>
        <input id="newkey" type="password" className="field mono" style={{ flexGrow: 1, minWidth: 220 }} placeholder="sk-ant-…" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button type="button" className="btn btn-red" data-sfx="none" disabled={testing} onClick={save}>
          <Icon d={P.lock} size={15} />
          {testing ? "Testing…" : "Test & save"}
        </button>
        <span className="muted" style={{ flexBasis: "100%", fontSize: 12 }}>
          Get a key at <a href="https://platform.claude.com" target="_blank" rel="noopener">platform.claude.com</a> → API keys. GitHub and Discord are connected from the Apps tab.
        </span>
      </div>
    </>
  );
}

function Engines() {
  const { state, refresh, toast } = useApp();
  const p = state.prefs;
  const patch = async (body: object) => {
    try {
      await api("/api/prefs", { method: "PATCH", body });
      await refresh();
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const cards: [string, string, string, string, boolean][] = [
    ["anthropic", "Claude", "Cloud API", "Thinking, writing, research and planning. Opus 5.5 first, then Sonnet 5.5 and Haiku 4.5 if one is busy or rate-limited.", state.engines.claudeKeys > 0],
    ["claudecode", "Claude Code", "Local agent", "Works inside a project folder: reads the code, edits files, runs safe commands like tests. Runs `claude -p` on this computer.", state.engines.claudeCode.ok],
    ["local", "Local model", "Offline · free", "Ollama or LM Studio on this computer. Private and unlimited — good for simple jobs.", state.engines.local],
  ];
  return (
    <>
      <Head n="02 — Engines" title="Claude, Claude Code or local — per job" sub="Not every job needs the same tool. Chats and plans go to Claude in the cloud; real code work goes to Claude Code, which can open your project and run tests. Auto picks for you." />
      <div className="k3" style={{ gap: 14 }}>
        {cards.map(([b, n, k, t, ok], i) => (
          <div key={n} className="card tilt rise" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10, animationDelay: `${i * 0.07}s`, borderColor: ok ? "rgba(255,43,58,0.4)" : undefined }}>
            <div className="row" style={{ gap: 12 }}>
              <Brand name={b} size={42} variant={i === 0 ? "red" : "tint"} />
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{n}</div>
                <div className="mono" style={{ fontSize: 10, color: ok ? "#FF5A66" : "#A1A1AA", letterSpacing: ".06em" }}>
                  {k.toUpperCase()} · {ok ? "READY" : "NOT SET UP"}
                </div>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: "#D4D4D8" }}>{t}</p>
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: 20, marginTop: 16, display: "flex", flexDirection: "column", gap: 18 }}>
        <div>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Default engine for new agents</div>
          <Seg label="Default engine" value={p.engine} onChange={(e: Engine) => patch({ engine: e })} width={420} options={[["auto", "Auto"], ["claude", "Claude"], ["code", "Claude Code"], ["local", "Local"]]} />
        </div>
        <div>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Claude Code permissions</div>
          <Seg label="Claude Code permissions" value={p.codePermission} onChange={(v) => patch({ codePermission: v })} width={340} options={[["acceptEdits", "Edit files"], ["plan", "Plan only"]]} />
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
            {p.codePermission === "plan" ? "Claude Code only reads and proposes — nothing changes." : "Claude Code can edit files in the project and run safe commands (tests, builds, git status/diff). Anything else is refused."}
          </p>
        </div>
        <div className="muted" style={{ fontSize: 13, lineHeight: 1.6, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
          <b style={{ color: "#F4F4F5" }}>How Auto decides:</b> anything about code, tests, bugs or repos → Claude Code (when installed). “Private” or “offline” → your local model (when set up). Everything else → Claude, with automatic fallback across models and keys.
        </div>
      </div>
    </>
  );
}

function Sound() {
  const sfx = useSfxPrefs();
  const [reduce, setReduce] = useState(() => document.documentElement.classList.contains("reduce-motion"));
  const toggleReduce = (v: boolean) => {
    setReduce(v);
    document.documentElement.classList.toggle("reduce-motion", v);
    try {
      localStorage.setItem("gug-reduce-motion", v ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const SOUNDS: [Sfx, string][] = [["tap", "Tap"], ["tab", "Tab"], ["toggle", "Toggle"], ["nav", "Navigate"], ["confirm", "Confirm"], ["success", "Success"], ["send", "Send"], ["pulse", "Core pulse"], ["boot", "Boot"], ["error", "Error"]];
  return (
    <>
      <Head n="03 — Sound & motion" title="Feel" sub="Every click, tab and toggle has its own sound, and every screen has its own transition. Sounds are synthesised live — nothing is downloaded." />
      <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ flexGrow: 1 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Sound effects</span>
            <span className="muted" style={{ display: "block", fontSize: 12 }}>Also on the speaker button in the top bar</span>
          </span>
          <Switch on={!sfx.muted} label="Sound effects" onChange={(v) => setSfx({ muted: !v })} />
        </div>
        <label className="row" style={{ gap: 16, fontSize: 13 }}>
          <span style={{ width: 90 }}>Volume</span>
          <input type="range" className="scrub" min={0} max={100} value={Math.round(sfx.vol * 100)} onChange={(e) => setSfx({ vol: Number(e.target.value) / 100 })} style={{ ["--p" as string]: `${sfx.vol * 100}%` }} />
          <span className="mono" style={{ width: 44, textAlign: "right" }}>{Math.round(sfx.vol * 100)}%</span>
        </label>
        <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
          <span style={{ width: 90, fontSize: 13 }}>Sound pack</span>
          <Seg label="Sound pack" value={sfx.pack} onChange={(v) => (setSfx({ pack: v }), setTimeout(() => play("tap"), 30))} width={300} options={[["synth", "Synth"], ["soft", "Soft"], ["click", "Click"]]} />
        </div>
        <div>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 10 }}>Preview</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {SOUNDS.map(([k, l]) => (
              <button key={k} type="button" className="chip" data-sfx="none" style={{ height: 34 }} onClick={() => play(k)}>
                <Icon d={P.play} size={12} />
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="card" style={{ padding: "18px 20px", marginTop: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ flexGrow: 1 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Reduce motion</span>
            <span className="muted" style={{ display: "block", fontSize: 12 }}>Swap transitions and spinning for quick fades. Your system setting is respected automatically.</span>
          </span>
          <Switch on={reduce} label="Reduce motion" onChange={toggleReduce} />
        </div>
      </div>
    </>
  );
}

function Data() {
  const { toast } = useApp();
  const [info, setInfo] = useState<{ dataDir: string; counts: Record<string, number> } | null>(null);
  const [chats, setChats] = useState(false);
  const [notify, setNotify] = useState(() => localStorage.getItem("gug-notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted");
  const file = useRef<HTMLInputElement>(null);
  const load = () => api<{ dataDir: string; counts: Record<string, number> }>("/api/storage").then(setInfo).catch(() => {});
  useEffect(() => void load(), []);

  const toggleNotify = async (v: boolean) => {
    if (v && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      const p = await Notification.requestPermission();
      if (p !== "granted") return toast("Your browser blocked notifications — allow them in the site settings.", "err");
    }
    setNotify(v);
    localStorage.setItem("gug-notify", v ? "1" : "0");
    if (v) new Notification("GUG-cli", { body: "Notifications are on. Flow results and price alerts will show up here.", icon: "/icon-192.png" });
  };

  const restore = async (f: File) => {
    try {
      const body = JSON.parse(await f.text());
      if (!confirm("Replace your flows, inbox, ventures, markets, posts and artwork with this backup? Your API keys stay as they are.")) return;
      const r = await api<Record<string, number>>("/api/restore", { body });
      play("success");
      toast(`Restored ${r.flows} flows, ${r.entries} money entries, ${r.posts} posts and ${r.art} artworks${r.skipped ? ` (${r.skipped} invalid items skipped)` : ""}.`);
      void load();
    } catch (e) {
      toast(e instanceof SyntaxError ? "That file isn’t valid JSON." : (e as Error).message, "err");
    } finally {
      if (file.current) file.current.value = "";
    }
  };

  const c = info?.counts ?? {};
  const LABELS: [string, string][] = [["flows", "Flows"], ["inbox", "Inbox items"], ["streams", "Income streams"], ["entries", "Money entries"], ["watch", "Watchlist"], ["posts", "Posts"], ["art", "Artworks"], ["chats", "Chat messages"]];
  return (
    <>
      <Head n="04 — Data & alerts" title="Your stuff, your computer" sub="Everything lives in one folder on this machine. Back it up, move it to a new computer, or switch on desktop alerts." />
      <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="row" style={{ gap: 12 }}>
          <span style={{ flexGrow: 1 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Desktop notifications</span>
            <span className="muted" style={{ display: "block", fontSize: 12 }}>Pop up when a flow finishes or a price alert fires, while GUG-cli is open.</span>
          </span>
          <Switch on={notify} label="Desktop notifications" onChange={(v) => void toggleNotify(v)} />
        </div>
      </div>
      <div className="card" style={{ padding: "18px 20px", marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Backup</div>
          <div className="muted" style={{ fontSize: 12 }}>One JSON file with your flows, money, markets, posts and artwork. API keys are never included.</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
          {LABELS.map(([k, l]) => (
            <div key={k} style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="disp" style={{ fontSize: 20, fontWeight: 300 }}>{(c[k] ?? 0).toLocaleString()}</div>
              <div className="mono muted" style={{ fontSize: 9, letterSpacing: ".08em" }}>{l.toUpperCase()}</div>
            </div>
          ))}
        </div>
        <label className="row" style={{ gap: 10, fontSize: 13 }}>
          <Switch on={chats} label="Include chat history" onChange={setChats} /> Include chat history
        </label>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <a className="btn btn-white" href={`/api/backup${chats ? "?chats=1" : ""}`} download style={{ textDecoration: "none" }}>
            <Icon d={P.down} size={14} /> Download backup
          </a>
          <button type="button" className="btn" onClick={() => file.current?.click()}>
            <Icon d={P.refresh} size={14} /> Restore from file…
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
        </div>
        {info && <div className="mono muted" style={{ fontSize: 11 }}>Data folder: {info.dataDir}</div>}
      </div>
    </>
  );
}
