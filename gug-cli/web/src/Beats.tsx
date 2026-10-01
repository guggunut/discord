// Studio → Beats: a 16-step sequencer with presets, swing and tempo.
import { useEffect, useRef, useState } from "react";
import { useApp } from "./App";
import { PRESETS, TRACKS, clonePattern, savedBeat, schedule, stepSeconds, type Pattern, type Track } from "./beats";
import { play as sfx } from "./sfx";
import { Icon, P } from "./ui";

const LABEL: Record<Track, string> = { kick: "Kick", snare: "Snare", hat: "Hi-hat", clap: "Clap", bass: "Bass" };

export function BeatsLab() {
  const { toast } = useApp();
  const [p, setP] = useState<Pattern>(() => savedBeat() ?? clonePattern(PRESETS[0]));
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(-1);
  const [exporting, setExporting] = useState(false);
  const pRef = useRef(p);
  pRef.current = p;
  const live = useRef<{ ac: AudioContext; timer: number; raf: number; barStart: number } | null>(null);

  const stop = () => {
    const l = live.current;
    if (!l) return;
    window.clearTimeout(l.timer);
    cancelAnimationFrame(l.raf);
    void l.ac.close();
    live.current = null;
    setPlaying(false);
    setStep(-1);
  };
  useEffect(() => stop, []);

  const start = () => {
    const ac = new AudioContext();
    const out = ac.createGain();
    out.gain.value = 0.8;
    out.connect(ac.destination);
    const l = { ac, timer: 0, raf: 0, barStart: ac.currentTime + 0.08 };
    live.current = l;
    // Schedule a bar at a time, a little ahead; edits land on the next bar.
    const loop = () => {
      const end = schedule(ac, out, pRef.current, l.barStart, 1);
      const next = end;
      l.timer = window.setTimeout(() => {
        l.barStart = next;
        loop();
      }, Math.max(0, (next - ac.currentTime - 0.15) * 1000));
    };
    loop();
    const tick = () => {
      const st = stepSeconds(pRef.current);
      const t = ac.currentTime - l.barStart;
      setStep(t >= 0 ? Math.floor(t / st) % 16 : 15);
      l.raf = requestAnimationFrame(tick);
    };
    l.raf = requestAnimationFrame(tick);
    setPlaying(true);
  };

  const toggle = (tr: Track, i: number) => setP((x) => ({ ...x, steps: { ...x.steps, [tr]: x.steps[tr].map((v, j) => (j === i ? !v : v)) } }));
  const save = () => {
    localStorage.setItem("gug-beat", JSON.stringify(p));
    sfx("success");
    toast("Saved — the Shorts maker will use this beat.");
  };
  const exportAudio = async () => {
    setExporting(true);
    try {
      const ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      const bars = 4;
      const t0 = ac.currentTime + 0.1;
      const end = schedule(ac, dest, p, t0, bars);
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(dest.stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise<void>((r) => (rec.onstop = () => r()));
      rec.start();
      await new Promise((r) => setTimeout(r, (end - ac.currentTime + 0.4) * 1000));
      rec.stop();
      await done;
      void ac.close();
      const blob = new Blob(chunks, { type: type.split(";")[0] || "audio/webm" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `gug-beat-${p.name.toLowerCase()}-${p.bpm}bpm.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      sfx("success");
    } catch (e) {
      toast(`Couldn’t export: ${(e as Error).message}`, "err");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="card rise d2" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
          <button type="button" className={`btn ${playing ? "btn-white" : "btn-red"}`} data-sfx="none" style={{ width: 120 }} onClick={() => (playing ? stop() : start())}>
            <Icon d={playing ? P.x : P.play} size={14} /> {playing ? "Stop" : "Play"}
          </button>
          {PRESETS.map((pr) => (
            <button key={pr.name} type="button" className="chip" aria-pressed={p.name === pr.name} onClick={() => setP(clonePattern(pr))} style={p.name === pr.name ? { borderColor: "rgba(255,43,58,0.6)", color: "#fff", background: "rgba(255,43,58,0.14)" } : undefined}>
              {pr.name}
            </button>
          ))}
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="chip" onClick={() => setP((x) => ({ ...x, name: "Custom", steps: Object.fromEntries(TRACKS.map((t) => [t, Array(16).fill(false)])) as Pattern["steps"] }))}>Clear</button>
          <button type="button" className="btn" onClick={save}><Icon d={P.check} size={14} /> Use in Shorts</button>
          <button type="button" className="btn" disabled={exporting} onClick={() => void exportAudio()}><Icon d={P.down} size={14} /> {exporting ? "Recording 4 bars…" : "Export audio"}</button>
        </div>
        <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
            <span className="eyebrow" style={{ fontSize: 10 }}>Tempo · {p.bpm} BPM</span>
            <input type="range" className="scrub" min={60} max={180} value={p.bpm} onChange={(e) => setP({ ...p, bpm: Number(e.target.value) })} style={{ ["--p" as string]: `${((p.bpm - 60) / 120) * 100}%` }} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 220px" }}>
            <span className="eyebrow" style={{ fontSize: 10 }}>Swing · {Math.round(p.swing * 100)}%</span>
            <input type="range" className="scrub" min={0} max={0.5} step={0.01} value={p.swing} onChange={(e) => setP({ ...p, swing: Number(e.target.value) })} style={{ ["--p" as string]: `${(p.swing / 0.5) * 100}%` }} />
          </label>
        </div>
      </div>

      <div className="card rise d3" style={{ padding: 18, overflowX: "auto" }}>
        <div className="beat-grid">
          {TRACKS.map((tr) => (
            <div key={tr} className="beat-row">
              <span className="mono beat-label">{LABEL[tr]}</span>
              {p.steps[tr].map((on, i) => (
                <button
                  key={i}
                  type="button"
                  data-sfx="none"
                  aria-label={`${LABEL[tr]} step ${i + 1}${on ? " on" : ""}`}
                  aria-pressed={on}
                  className={`beat-cell ${on ? "on" : ""} ${i % 4 === 0 ? "bar" : ""} ${step === i ? "now" : ""} ${tr === "bass" ? "bass" : ""}`}
                  onClick={() => toggle(tr, i)}
                />
              ))}
            </div>
          ))}
        </div>
        <p className="muted" style={{ margin: "12px 0 0", fontSize: 11 }}>Click squares to add hits. Changes play from the next bar. Everything is synthesised live — no samples, nothing downloaded.</p>
      </div>
    </div>
  );
}
