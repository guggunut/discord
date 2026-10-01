// Live view: see what Forge is building in another app. Either Blender's own
// viewport (snapshots from its add-on) or any window you share (Roblox Studio,
// Unity, a game…) via the browser's screen picker — nothing leaves this computer.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Brand, Icon, P } from "./ui";

interface Frame {
  src: string;
  at: number;
  label: string;
}
const MAX_FRAMES = 40;

export interface Activity {
  text: string;
  at: number;
}

type Source = "none" | "blender" | "window";

export function LiveView({ activity, busy, hasBlender }: { activity: Activity[]; busy: boolean; hasBlender: boolean }) {
  const [source, setSource] = useState<Source>(() => (localStorage.getItem("gug-live") as Source) || (hasBlender ? "blender" : "none"));
  const [snap, setSnap] = useState<{ image: string; scene: { name?: string; objects: { name: string; type: string }[] }; at: string } | null>(null);
  const [err, setErr] = useState("");
  const [auto, setAuto] = useState(true);
  const video = useRef<HTMLVideoElement>(null);
  const share = useRef<MediaStream | null>(null);
  const [sharing, setSharing] = useState(false);
  // Build timeline: distinct frames captured while Forge works, to scrub or replay.
  const [frames, setFrames] = useState<Frame[]>([]);
  const [view, setView] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const latestRef = useRef<string>("");
  latestRef.current = activity.at(-1)?.text ?? "";
  const addFrame = (src: string) =>
    setFrames((f) => (f.at(-1)?.src === src ? f : [...f, { src, at: Date.now(), label: latestRef.current }].slice(-MAX_FRAMES)));

  // A new build starts a new timeline.
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy && !wasBusy.current) (setFrames([]), setView(null), setPlaying(false));
    wasBusy.current = busy;
  }, [busy]);

  // Frames from a shared window: grab one every 2.5 s while building.
  useEffect(() => {
    if (!busy || !sharing) return;
    const c = document.createElement("canvas");
    const grab = () => {
      const v = video.current;
      if (!v || !v.videoWidth) return;
      c.width = 640;
      c.height = Math.round((640 * v.videoHeight) / v.videoWidth);
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      addFrame(c.toDataURL("image/jpeg", 0.72));
    };
    const t = window.setInterval(grab, 2500);
    return () => window.clearInterval(t);
  }, [busy, sharing]);

  // Timelapse replay at ~4 fps.
  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      setView((v) => {
        const next = (v ?? -1) + 1;
        if (next >= frames.length) {
          setPlaying(false);
          return frames.length - 1;
        }
        return next;
      });
    }, 260);
    return () => window.clearInterval(t);
  }, [playing, frames.length]);

  useEffect(() => {
    try {
      localStorage.setItem("gug-live", source);
    } catch {
      /* private mode */
    }
  }, [source]);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  // Blender: refresh the viewport every 2 s while building (every 6 s otherwise).
  useEffect(() => {
    if (source !== "blender" || !auto) return;
    let alive = true;
    const pull = () =>
      api<typeof snap>("/api/live/blender")
        .then((s) => {
          if (!alive || !s) return;
          setSnap(s);
          setErr("");
          if (busyRef.current) addFrame(s.image);
        })
        .catch((e) => alive && setErr((e as Error).message));
    void pull();
    const t = window.setInterval(pull, busy ? 2000 : 6000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [source, auto, busy]);

  const stopShare = () => {
    share.current?.getTracks().forEach((t) => t.stop());
    share.current = null;
    setSharing(false);
  };
  useEffect(() => stopShare, []);
  const startShare = async () => {
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
      share.current = s;
      s.getVideoTracks()[0]?.addEventListener("ended", stopShare);
      setSharing(true);
      setSource("window");
      setTimeout(() => {
        if (video.current) video.current.srcObject = s;
      }, 0);
    } catch {
      /* picker cancelled */
    }
  };

  const latest = activity.at(-1);
  const shown = view !== null ? frames[view] : null;
  const save = () => {
    const f = shown ?? frames.at(-1);
    if (!f) return;
    const a = document.createElement("a");
    a.href = f.src;
    a.download = `gug-build-${new Date(f.at).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${f.src.startsWith("data:image/jpeg") ? "jpg" : "png"}`;
    a.click();
  };
  return (
    <div className="live">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <button type="button" className={`chip ${source === "blender" ? "on" : ""}`} onClick={() => (stopShare(), setSource("blender"))}>
          <Brand name="blender" size={18} variant={source === "blender" ? "red" : ""} /> Blender viewport
        </button>
        <button type="button" className={`chip ${source === "window" ? "on" : ""}`} onClick={() => void startShare()}>
          <Icon d="M3 5h18v12H3zM8 21h8M12 17v4" size={13} /> {sharing ? "Change window" : "Watch a window"}
        </button>
        {sharing && (
          <button type="button" className="chip" onClick={() => (stopShare(), setSource("none"))}>
            <Icon d={P.x} size={11} /> Stop sharing
          </button>
        )}
        <span style={{ flexGrow: 1 }} />
        {source === "blender" && (
          <label className="row mono muted" style={{ gap: 6, fontSize: 10 }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} style={{ accentColor: "#FF2B3A" }} /> AUTO-REFRESH
          </label>
        )}
      </div>

      <div className="live-screen">
        {shown ? (
          <img src={shown.src} alt={`Build frame ${view! + 1} of ${frames.length}`} />
        ) : source === "window" && sharing ? (
          <video ref={video} autoPlay muted playsInline aria-label="Shared window" />
        ) : source === "blender" && snap ? (
          <img src={snap.image} alt="Blender viewport" />
        ) : (
          <div className="live-empty">
            <div className="disp" style={{ fontSize: 18, fontWeight: 300 }}>{source === "blender" ? (err ? "Blender isn’t connected" : "Connecting to Blender…") : "See what you’re building"}</div>
            <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, maxWidth: 420, margin: "8px auto 0" }}>
              {source === "blender"
                ? err || "Waiting for the first viewport frame."
                : "Show Blender’s viewport here, or share any window — Roblox Studio, Unity, your game — and watch it change while Forge works through MCP."}
            </p>
          </div>
        )}
        {shown ? (
          <div className="live-hud">
            <span className="live-dot replay">{playing ? "▶ REPLAY" : `FRAME ${view! + 1}/${frames.length}`}</span>
            {shown.label && <span className="mono live-act">▸ {shown.label}</span>}
          </div>
        ) : (
          (busy || latest) && (
            <div className="live-hud">
              {busy && <span className="live-dot">● LIVE</span>}
              {latest && <span className="mono live-act">▸ {latest.text}</span>}
            </div>
          )
        )}
        {!shown && source === "blender" && snap && snap.scene.objects.length > 0 && (
          <div className="live-scene mono">
            <b>{snap.scene.name ?? "Scene"}</b>
            {snap.scene.objects.slice(0, 8).map((o) => (
              <span key={o.name}>
                {o.type === "MESH" ? "◆" : o.type === "LIGHT" ? "✦" : o.type === "CAMERA" ? "◉" : "·"} {o.name}
              </span>
            ))}
            {snap.scene.objects.length > 8 && <span>+{snap.scene.objects.length - 8} more</span>}
          </div>
        )}
      </div>
      {frames.length > 0 && (
        <div className="live-strip">
          <button type="button" className="chip" aria-label={playing ? "Pause replay" : "Replay build"} onClick={() => (playing ? setPlaying(false) : (setView(-1 + (view === frames.length - 1 || view === null ? 0 : view + 1)), setPlaying(true)))} disabled={frames.length < 2}>
            <Icon d={playing ? "M7 5h3v14H7zM14 5h3v14h-3z" : "M7 5l12 7-12 7z"} size={11} /> {playing ? "Pause" : "Replay"}
          </button>
          <div className="live-thumbs scroll" role="listbox" aria-label="Build timeline">
            {frames.map((f, i) => (
              <button key={f.at + i} type="button" role="option" aria-selected={view === i} className={view === i ? "on" : ""} title={f.label || `Frame ${i + 1}`} onClick={() => (setPlaying(false), setView(view === i ? null : i))}>
                <img src={f.src} alt="" />
              </button>
            ))}
          </div>
          {view !== null && (
            <button type="button" className="chip on" onClick={() => (setPlaying(false), setView(null))}>
              <span className="live-dot-sm" /> Live
            </button>
          )}
          <button type="button" className="chip" aria-label="Save frame" title="Save this frame as an image" onClick={save}>
            <Icon d="M12 4v11M7 10l5 5 5-5M5 20h14" size={11} />
          </button>
        </div>
      )}
      {activity.length > 0 && (
        <div className="live-feed mono">
          {activity.slice(-6).map((a, i) => (
            <span key={a.at + i} className="pop">▸ {a.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}
