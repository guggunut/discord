// Shorts maker: artwork + caption lines → a 9:16 video with slow camera motion,
// kinetic captions and an optional synth beat, recorded in the browser
// (canvas + MediaRecorder). Nothing is uploaded anywhere.
import { useEffect, useRef, useState } from "react";
import { api, stream, type GugEvent } from "./api";
import { useApp } from "./App";
import { toLines } from "./captions";
import { savedBeat, schedule, stepSeconds } from "./beats";
import { play } from "./sfx";
import { Icon, P, Seg, Sigil, Switch } from "./ui";

interface Art { id: string; title: string }
const W = 720;
const H = 1280;
const RED = "#FF2B3A";

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(" ")) {
    const next = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(next).width > max && cur) {
      lines.push(cur);
      cur = word;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** A tiny looping beat: kick, hat and a minor arpeggio, routed into the recording. */
function startBeat(ac: AudioContext, dest: AudioNode, seconds: number) {
  const bpm = 100;
  const beat = 60 / bpm;
  const notes = [220, 261.63, 329.63, 392, 329.63, 261.63, 196, 246.94];
  const out = ac.createGain();
  out.gain.value = 0.5;
  out.connect(dest);
  out.connect(ac.destination);
  const t0 = ac.currentTime + 0.05;
  for (let i = 0; i * beat < seconds; i++) {
    const t = t0 + i * beat;
    // kick
    const k = ac.createOscillator();
    const kg = ac.createGain();
    k.frequency.setValueAtTime(120, t);
    k.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    kg.gain.setValueAtTime(0.9, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    k.connect(kg).connect(out);
    k.start(t);
    k.stop(t + 0.3);
    // arp (two notes per beat)
    for (const half of [0, 0.5]) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "triangle";
      o.frequency.value = notes[(i * 2 + (half ? 1 : 0)) % notes.length];
      const s = t + half * beat;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.12, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, s + beat * 0.45);
      o.connect(g).connect(out);
      o.start(s);
      o.stop(s + beat * 0.5);
    }
  }
}

export function ShortsLab() {
  const { toast, state } = useApp();
  const [art, setArt] = useState<Art[]>([]);
  const [artId, setArtId] = useState("");
  const [text, setText] = useState("Your desk, but cinematic.\nOne bar of red light.\nTouch to dim.\nLumen. Link in bio.");
  const [secs, setSecs] = useState(2.5);
  const [music, setMusic] = useState(true);
  const [look, setLook] = useState<"pop" | "type">("pop");
  const [rendering, setRendering] = useState(0); // 0..1 progress, 0 = idle
  const [video, setVideo] = useState<{ url: string; size: number } | null>(null);
  const [topic, setTopic] = useState("");
  const [writing, setWriting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement | null>(null);
  const supported = typeof MediaRecorder !== "undefined" && typeof HTMLCanvasElement !== "undefined" && "captureStream" in HTMLCanvasElement.prototype;
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 30);
  const total = Math.max(1, lines.length) * secs + 1.2;

  useEffect(() => {
    void api<{ art: Art[] }>("/api/studio").then((r) => {
      setArt(r.art);
      if (r.art[0]) setArtId(r.art[0].id);
    });
  }, []);
  useEffect(() => {
    img.current = null;
    if (!artId) return void draw(0.35);
    const i = new Image();
    i.src = `/api/studio/art/${artId}`;
    i.onload = () => ((img.current = i), draw(0.35));
  }, [artId]);
  useEffect(() => draw(0.35), [text, look]);
  useEffect(() => () => void (video && URL.revokeObjectURL(video.url)), [video]);

  /** Draws the frame at time t (seconds). */
  function draw(t: number) {
    const c = canvas.current?.getContext("2d");
    if (!c) return;
    c.fillStyle = "#030303";
    c.fillRect(0, 0, W, H);
    // artwork with a slow push-in and drift
    if (img.current) {
      const z = 1.08 + 0.12 * (t / total);
      const size = H * z;
      c.globalAlpha = 0.9;
      c.drawImage(img.current, (W - size) / 2 - 40 * Math.sin(t / total * Math.PI), (H - size) / 2 - 60 * (t / total), size, size);
      c.globalAlpha = 1;
    }
    // red glow + grid
    const glow = c.createRadialGradient(W * 0.7, H * 0.2, 0, W * 0.7, H * 0.2, W);
    glow.addColorStop(0, "rgba(255,43,58,0.28)");
    glow.addColorStop(1, "rgba(3,3,3,0)");
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);
    const shade = c.createLinearGradient(0, H * 0.45, 0, H);
    shade.addColorStop(0, "rgba(3,3,3,0)");
    shade.addColorStop(1, "rgba(3,3,3,0.92)");
    c.fillStyle = shade;
    c.fillRect(0, 0, W, H);
    // progress bar
    c.fillStyle = "rgba(255,255,255,0.12)";
    c.fillRect(40, 60, W - 80, 6);
    c.fillStyle = RED;
    c.fillRect(40, 60, (W - 80) * Math.min(1, t / total), 6);
    // caption
    const i = Math.min(lines.length - 1, Math.floor(t / secs));
    const line = lines[i] ?? "Type your captions →";
    const local = t - i * secs;
    c.font = "800 64px system-ui, -apple-system, 'Segoe UI', sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    const rows = wrap(c, line, W - 120);
    const pop = look === "pop" ? Math.min(1, local / 0.18) : 1;
    const shown = look === "type" ? Math.floor(Math.min(1, local / (secs * 0.6)) * line.length) : line.length;
    c.save();
    c.translate(W / 2, H * 0.72);
    c.scale(0.8 + 0.2 * pop, 0.8 + 0.2 * pop);
    c.globalAlpha = pop;
    let chars = 0;
    rows.forEach((r, k) => {
      const y = (k - (rows.length - 1) / 2) * 78;
      const visible = r.slice(0, Math.max(0, shown - chars));
      chars += r.length + 1;
      const w = c.measureText(r).width;
      c.fillStyle = k === rows.length - 1 ? RED : "rgba(255,255,255,0.08)";
      c.fillRect(-w / 2 - 18, y - 42, w + 36, 84);
      c.fillStyle = "#fff";
      c.shadowColor = "rgba(0,0,0,0.6)";
      c.shadowBlur = 12;
      c.fillText(visible, 0, y + 2);
      c.shadowBlur = 0;
    });
    c.restore();
    // watermark
    c.font = "600 22px ui-monospace, monospace";
    c.textAlign = "left";
    c.fillStyle = "rgba(255,255,255,0.55)";
    c.fillText("GUG", 40, H - 56);
    c.fillStyle = RED;
    c.fillText("●", 96, H - 56);
  }

  const render = async () => {
    const cv = canvas.current;
    if (!cv || !supported || !lines.length) return;
    if (video) URL.revokeObjectURL(video.url);
    setVideo(null);
    play("send");
    const streamV = cv.captureStream(30);
    let ac: AudioContext | null = null;
    if (music) {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      const mine = savedBeat();
      if (mine) {
        // Your beat from Studio → Beats, looped for the length of the video.
        const mix = ac.createGain();
        mix.gain.value = 0.7;
        mix.connect(dest);
        mix.connect(ac.destination);
        schedule(ac, mix, mine, ac.currentTime + 0.05, Math.ceil(total / (16 * stepSeconds(mine))));
      } else startBeat(ac, dest, total);
      dest.stream.getAudioTracks().forEach((tr) => streamV.addTrack(tr));
    }
    const type = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    const rec = new MediaRecorder(streamV, { mimeType: type || undefined, videoBitsPerSecond: 6_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => (rec.onstop = () => r()));
    rec.start(250);
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = () => {
        const t = (performance.now() - start) / 1000;
        draw(Math.min(t, total));
        setRendering(Math.max(0.01, Math.min(1, t / total)));
        if (t < total) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    rec.stop();
    await done;
    streamV.getTracks().forEach((tr) => tr.stop());
    void ac?.close();
    const blob = new Blob(chunks, { type: "video/webm" });
    setVideo({ url: URL.createObjectURL(blob), size: blob.size });
    setRendering(0);
    play("success");
  };

  const writeCaptions = () => {
    if (!topic.trim()) return toast("What's the short about?", "err");
    play("send");
    setWriting(true);
    let script = "";
    stream("/api/studio/script", { topic, seconds: 15, tone: "hype and energetic" }, (ev: GugEvent) => {
      if (ev.type === "text") script += ev.text;
      if (ev.type === "error") toast(ev.message, "err");
    }, () => {
      setWriting(false);
      if (script.trim()) setText(toLines(script.replace(/[*_#>`]/g, "")).join("\n"));
    });
  };

  return (
    <div className="g2r cols" style={{ ["--cols" as string]: "minmax(0,1fr) 400px" }}>
      <section style={{ display: "flex", flexDirection: "column", gap: 18, minWidth: 0 }}>
        <div className="card rise d2" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 10 }}>
            <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400, flexGrow: 1 }}>Captions <span className="muted" style={{ fontSize: 12 }}>· one line per beat</span></h2>
            <Seg label="Caption style" value={look} width={200} options={[["pop", "Pop"], ["type", "Type-on"]]} onChange={setLook} />
          </div>
          <textarea aria-label="Caption lines" className="field" rows={7} value={text} onChange={(e) => setText(e.target.value)} style={{ fontSize: 15, lineHeight: 1.6 }} />
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 200px" }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Background</span>
              <select className="field" value={artId} onChange={(e) => setArtId(e.target.value)}>
                <option value="">Plain (no artwork)</option>
                {art.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}
              </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 6, flex: "1 1 160px" }}>
              <span className="eyebrow" style={{ fontSize: 10 }}>Seconds per line · {secs.toFixed(1)}</span>
              <input type="range" className="scrub" min={1.5} max={4} step={0.5} value={secs} onChange={(e) => setSecs(Number(e.target.value))} style={{ ["--p" as string]: `${((secs - 1.5) / 2.5) * 100}%`, marginTop: 14 }} />
            </label>
            <label className="row" style={{ gap: 8, fontSize: 13 }}>
              <Switch on={music} label="Music" onChange={setMusic} /> {savedBeat() ? `Your beat (${savedBeat()!.name})` : "Synth beat"}
            </label>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-red" data-sfx="none" disabled={!supported || !!rendering || !lines.length} onClick={() => void render()}>
              <Icon d={P.play} size={14} /> {rendering ? `Recording… ${Math.round(rendering * 100)}%` : `Render ${total.toFixed(0)}s video`}
            </button>
            {video && (
              <a className="btn btn-white" href={video.url} download={`gug-short-${Date.now()}.webm`} style={{ textDecoration: "none" }}>
                <Icon d={P.down} size={14} /> Download ({(video.size / 1e6).toFixed(1)} MB)
              </a>
            )}
            <span className="muted" style={{ fontSize: 12 }}>{supported ? "Renders in real time on this computer · WebM, 720×1280" : "This browser can't record video — try Chrome or Edge."}</span>
          </div>
        </div>
        <div className="card hot rise d3" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row">
            <Sigil id="vox" size={34} />
            <div style={{ fontSize: 15, fontWeight: 600 }}>Have Vox write the captions</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input aria-label="What's the short about?" className="field" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. a 15-second hype short for my red desk lamp" style={{ flexGrow: 1 }} />
            <button type="button" className="btn btn-red" data-sfx="none" disabled={writing || !state.engines.claudeKeys} onClick={writeCaptions}>
              <Icon d={P.wand} size={14} /> {writing ? "Writing…" : "Write"}
            </button>
          </div>
          <p className="muted" style={{ margin: 0, fontSize: 11 }}>Upload the WebM to TikTok, Reels or Shorts (or convert it to MP4 with any free converter). Add a voiceover from the Voice tab in your editor of choice.</p>
        </div>
      </section>
      <section className="card rise d4" style={{ padding: 14, alignSelf: "start", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
        {video && !rendering ? (
          <video src={video.url} controls autoPlay loop playsInline style={{ width: "100%", maxWidth: 360, aspectRatio: "9 / 16", borderRadius: 18, background: "#000", border: "1px solid rgba(255,43,58,0.4)" }} />
        ) : (
          <canvas ref={canvas} width={W} height={H} aria-label="Video preview" style={{ width: "100%", maxWidth: 360, aspectRatio: "9 / 16", borderRadius: 18, border: `1px solid ${rendering ? "rgba(255,43,58,0.6)" : "rgba(255,255,255,0.08)"}`, boxShadow: rendering ? "0 0 60px -20px #FF2B3A" : undefined }} />
        )}
        {video && !rendering && (
          <button type="button" className="chip" onClick={() => (URL.revokeObjectURL(video.url), setVideo(null), setTimeout(() => draw(0.35), 50))}>
            <Icon d={P.refresh} size={12} /> Back to editor
          </button>
        )}
      </section>
    </div>
  );
}
