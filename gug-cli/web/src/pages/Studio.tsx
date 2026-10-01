import { useEffect, useRef, useState } from "react";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { play } from "../sfx";
import { ShortsLab } from "../Shorts";
import { Icon, P, Seg, Sigil } from "../ui";

interface Art { id: string; title: string; prompt: string; style: string; at: string; bytes: number }
const STYLE_LABEL: Record<string, string> = { neon: "Neon noir", minimal: "Minimal", poster: "Poster", isometric: "Isometric", logo: "Logo mark", pattern: "Pattern" };
const IDEAS = ["A desk lamp product shot with a red rim light", "Logo for a Roblox obby called Sky Obby", "An isometric gaming desk setup at night", "Album cover: a heart made of circuit lines"];
const src = (id: string) => `/api/studio/art/${id}`;
const slug = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "artwork";

export function Studio() {
  const [tab, setTab] = useState<"image" | "voice" | "shorts">(() => (localStorage.getItem("gug-studio-prompt") ? "image" : (localStorage.getItem("gug-studio-tab") as "voice") || "image"));
  useEffect(() => {
    try {
      localStorage.setItem("gug-studio-tab", tab);
    } catch {
      /* private mode */
    }
  }, [tab]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="row rise d1">
        <Seg label="Studio" value={tab} width={480} options={[["image", "Artwork · Muse"], ["shorts", "Shorts · video"], ["voice", "Voice · Vox"]]} onChange={setTab} />
      </div>
      <div key={tab} className={tab === "image" ? "tx-zoom" : tab === "shorts" ? "tx-iris" : "tx-flip"}>{tab === "image" ? <ImageLab /> : tab === "shorts" ? <ShortsLab /> : <VoiceLab />}</div>
    </div>
  );
}

function ImageLab() {
  const { toast, state, go } = useApp();
  const [art, setArt] = useState<Art[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [style, setStyle] = useState("neon");
  const [prompt, setPrompt] = useState(() => {
    const p = localStorage.getItem("gug-studio-prompt") ?? "";
    localStorage.removeItem("gug-studio-prompt");
    return p;
  });
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<Art | null>(null);
  const abortRef = useRef<() => void>(() => {});

  const load = async () => {
    const r = await api<{ art: Art[]; styles: string[] }>("/api/studio");
    setArt(r.art);
    setStyles(r.styles);
    return r;
  };
  useEffect(() => {
    void load().then((r) => setOpen(r.art[0] ?? null));
    return () => abortRef.current();
  }, []);

  const draw = () => {
    if (!prompt.trim()) return;
    play("send");
    setBusy("Muse is sketching…");
    abortRef.current = stream("/api/studio/draw", { prompt, style }, (ev: GugEvent | { type: "art"; art: Art }) => {
      if (ev.type === "tool") setBusy(ev.detail);
      if (ev.type === "fallback") setBusy(`Switching to ${ev.to ?? "the next model"}…`);
      if (ev.type === "error") toast(ev.message, "err");
      if (ev.type === "art") {
        play("success");
        setOpen(ev.art);
        void load();
      }
    }, () => setBusy(""));
  };

  const png = async (a: Art) => {
    const img = new Image();
    img.src = src(a.id);
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 2048;
    c.getContext("2d")!.drawImage(img, 0, 0, 2048, 2048);
    c.toBlob((b) => {
      if (!b) return toast("Couldn’t make a PNG.", "err");
      const url = URL.createObjectURL(b);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${slug(a.title)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, "image/png");
  };
  const toCode = async (a: Art) => {
    try {
      const r = await api<{ path: string; project: string }>(`/api/studio/art/${a.id}/to-project`, { body: { project: "playground" } });
      toast(`Saved to ${r.project}/${r.path}.`);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };
  const remove = async (a: Art) => {
    if (!confirm(`Delete “${a.title}”?`)) return;
    await api(`/api/studio/art/${a.id}`, { method: "DELETE" });
    const r = await load();
    setOpen(r.art[0] ?? null);
  };
  const toEcho = (a: Art) => {
    localStorage.setItem("gug-agent", "echo");
    localStorage.setItem("gug-prefill", `I made an image: “${a.prompt}”. Write 3 captions for Instagram and TikTok with hashtags, matching a black/red/white brand.`);
    go("agents");
  };

  return (
    <div className="g2r">
      <section style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <div className="card rise d2" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row">
            <Sigil id="muse" size={36} />
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>What should Muse draw?</div>
              <div className="muted" style={{ fontSize: 12 }}>Vector artwork you can scale to any size, export as PNG, or drop into a Code project.</div>
            </div>
          </div>
          <textarea
            aria-label="Describe the artwork"
            className="field"
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.metaKey || e.ctrlKey) && draw()}
            placeholder="e.g. A minimal fox logo made of three triangles"
          />
          <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            {styles.map((s) => (
              <button key={s} type="button" className="chip" aria-pressed={style === s} onClick={() => setStyle(s)} style={style === s ? { borderColor: "rgba(255,43,58,0.6)", color: "#fff", background: "rgba(255,43,58,0.14)" } : undefined}>
                {STYLE_LABEL[s] ?? s}
              </button>
            ))}
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="btn btn-red" data-sfx="none" disabled={!!busy || !prompt.trim() || !state.engines.claudeKeys} title={state.engines.claudeKeys ? "Ctrl/⌘ + Enter" : "Add a Claude key first"} onClick={draw}>
              <Icon d={P.wand} size={14} /> {busy ? "Drawing…" : "Draw it"}
            </button>
          </div>
          {!prompt && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              <span className="eyebrow" style={{ fontSize: 9 }}>Try</span>
              {IDEAS.map((i) => (
                <button key={i} type="button" className="chip" style={{ height: 26, fontSize: 11 }} onClick={() => setPrompt(i)}>{i}</button>
              ))}
            </div>
          )}
        </div>

        <div className="card rise d3" style={{ padding: 18 }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Gallery</h2>
            <span className="mono muted" style={{ fontSize: 10 }}>{art.length} PIECES</span>
          </div>
          {!art.length && !busy && <div className="muted" style={{ fontSize: 13 }}>Nothing yet — your first piece will appear here.</div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
            {busy && (
              <div className="studio-tile studio-busy" aria-live="polite">
                <span className="mono" style={{ fontSize: 10 }}>{busy}</span>
              </div>
            )}
            {art.map((a, i) => (
              <button key={a.id} type="button" className={`studio-tile pop ${open?.id === a.id ? "on" : ""}`} style={{ animationDelay: `${i * 0.04}s` }} onClick={() => setOpen(a)} aria-label={a.title}>
                <img src={src(a.id)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card hot rise d4" style={{ padding: 18, alignSelf: "start", display: "flex", flexDirection: "column", gap: 12 }}>
        {!open ? (
          <div className="muted" style={{ fontSize: 13, padding: 20, textAlign: "center" }}>Pick a piece to see it large.</div>
        ) : (
          <div key={open.id} className="tx-iris" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="studio-stage">
              <img src={src(open.id)} alt={open.title} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{open.title}</div>
              <div className="mono muted" style={{ fontSize: 10, marginTop: 4 }}>
                {(STYLE_LABEL[open.style] ?? open.style).toUpperCase()} · {(open.bytes / 1024).toFixed(1)} KB · {new Date(open.at).toLocaleString()}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <a className="btn" href={src(open.id)} download={`${slug(open.title)}.svg`} style={{ textDecoration: "none", justifyContent: "center" }}>
                <Icon d={P.down} size={14} /> SVG
              </a>
              <button type="button" className="btn" onClick={() => void png(open)}>
                <Icon d={P.down} size={14} /> PNG 2048
              </button>
              <button type="button" className="btn" onClick={() => void toCode(open)}>
                <Icon d={P.Code} size={14} /> To Code
              </button>
              <button type="button" className="btn" onClick={() => toEcho(open)}>
                <Icon d={P.send} size={14} /> Captions
              </button>
            </div>
            <div className="row">
              <button type="button" className="chip" onClick={() => (setPrompt(open.prompt), setStyle(open.style))}>
                <Icon d={P.refresh} size={12} /> Remix prompt
              </button>
              <span style={{ flexGrow: 1 }} />
              <button type="button" className="chip" style={{ color: "#FF5A66" }} onClick={() => void remove(open)}>
                <Icon d={P.x} size={12} /> Delete
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function VoiceLab() {
  const { toast, state } = useApp();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voice, setVoice] = useState("");
  const [rate, setRate] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [text, setText] = useState("Welcome to GUG-cli. Twelve agents, one desk, and nothing leaves your computer unless you say so.");
  const [topic, setTopic] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [tone, setTone] = useState("warm and confident");
  const [writing, setWriting] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [at, setAt] = useState(-1);
  const abortRef = useRef<() => void>(() => {});
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;

  useEffect(() => {
    if (!supported) return;
    const pick = () => {
      const v = speechSynthesis.getVoices();
      setVoices(v);
      setVoice((cur) => cur || (v.find((x) => x.lang === "en-GB") ?? v.find((x) => x.lang.startsWith("en")) ?? v[0])?.name || "");
    };
    pick();
    speechSynthesis.addEventListener("voiceschanged", pick);
    return () => {
      speechSynthesis.removeEventListener("voiceschanged", pick);
      speechSynthesis.cancel();
      abortRef.current();
    };
  }, []);

  const speak = () => {
    if (!supported) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = voices.find((x) => x.name === voice);
    if (v) u.voice = v;
    u.rate = rate;
    u.pitch = pitch;
    u.onstart = () => setSpeaking(true);
    u.onend = u.onerror = () => (setSpeaking(false), setAt(-1));
    u.onboundary = (e) => setAt(e.charIndex);
    speechSynthesis.speak(u);
  };
  const stop = () => {
    speechSynthesis.cancel();
    setSpeaking(false);
    setAt(-1);
  };
  const write = () => {
    if (!topic.trim()) return toast("Tell Vox what it’s about first.", "err");
    play("send");
    setWriting(true);
    setText("");
    abortRef.current = stream("/api/studio/script", { topic, seconds, tone }, (ev: GugEvent) => {
      if (ev.type === "text") setText((t) => t + ev.text);
      if (ev.type === "error") toast(ev.message, "err");
    }, () => setWriting(false));
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  // Highlight the word being spoken.
  const before = at >= 0 ? text.slice(0, at) : text;
  const rest = at >= 0 ? text.slice(at) : "";
  const word = rest.match(/^\S+/)?.[0] ?? "";

  return (
    <div className="g2r">
      <section style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <div className="card rise d2" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row">
            <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Script</h2>
            <span className="mono muted" style={{ fontSize: 10 }}>{words} WORDS · ≈ {Math.round((words / 150) * 60 / rate)} S</span>
          </div>
          {speaking ? (
            <div className="field" aria-live="off" style={{ minHeight: 180, lineHeight: 1.8, fontSize: 16, whiteSpace: "pre-wrap" }}>
              <span style={{ color: "#71717A" }}>{before}</span>
              <span style={{ background: "#FF2B3A", color: "#fff", borderRadius: 4, padding: "0 3px", boxShadow: "0 0 16px rgba(255,43,58,.7)" }}>{word}</span>
              {rest.slice(word.length)}
            </div>
          ) : (
            <textarea aria-label="Script" className="field" rows={8} value={text} onChange={(e) => setText(e.target.value)} style={{ fontSize: 15, lineHeight: 1.7 }} />
          )}
          <div className="vox-viz" aria-hidden="true" data-on={speaking || undefined}>
            {Array.from({ length: 48 }, (_, i) => <i key={i} style={{ animationDelay: `${(i * 37) % 600}ms` }} />)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {speaking ? (
              <button type="button" className="btn btn-white" onClick={stop}><Icon d={P.x} size={14} /> Stop</button>
            ) : (
              <button type="button" className="btn btn-red" disabled={!supported || !text.trim()} onClick={speak}><Icon d={P.play} size={14} /> Play voiceover</button>
            )}
            <span className="muted" style={{ fontSize: 12 }}>{supported ? "Uses your computer’s built-in voices — nothing is uploaded." : "This browser has no built-in speech."}</span>
          </div>
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <div className="card rise d3" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>Voice</h2>
          <select aria-label="Voice" className="field" value={voice} onChange={(e) => setVoice(e.target.value)}>
            {!voices.length && <option value="">Default voice</option>}
            {voices.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.lang}</option>)}
          </select>
          <Slider label="Speed" value={rate} min={0.6} max={1.6} step={0.05} onChange={setRate} fmt={(v) => `${v.toFixed(2)}×`} />
          <Slider label="Pitch" value={pitch} min={0.5} max={1.5} step={0.05} onChange={setPitch} fmt={(v) => v.toFixed(2)} />
        </div>
        <div className="card hot rise d4" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row">
            <Sigil id="vox" size={36} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Have Vox write it</div>
          </div>
          <textarea aria-label="Voiceover topic" className="field" rows={2} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. 30-second ad for a red ambient desk lamp" />
          <div className="row" style={{ gap: 8 }}>
            <select aria-label="Length" className="field" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} style={{ flex: 1 }}>
              {[15, 30, 60, 90, 120].map((s) => <option key={s} value={s}>{s} seconds</option>)}
            </select>
            <select aria-label="Tone" className="field" value={tone} onChange={(e) => setTone(e.target.value)} style={{ flex: 1 }}>
              {["warm and confident", "hype and energetic", "calm and premium", "funny and casual", "documentary"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-red" data-sfx="none" disabled={writing || !state.engines.claudeKeys} title={state.engines.claudeKeys ? "" : "Add a Claude key first"} onClick={write}>
            <Icon d={P.wand} size={14} /> {writing ? "Writing…" : "Write script"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, fmt }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="row" style={{ fontSize: 12 }}>
        <span className="eyebrow" style={{ fontSize: 10, flexGrow: 1 }}>{label}</span>
        <span className="mono">{fmt(value)}</span>
      </span>
      <input type="range" className="scrub" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ ["--p" as string]: `${((value - min) / (max - min)) * 100}%` }} />
    </label>
  );
}
