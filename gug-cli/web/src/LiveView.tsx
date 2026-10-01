// Live view: see what Forge is building in another app. Either Blender's own
// viewport (snapshots from its add-on) or any window you share (Roblox Studio,
// Unity, a game…) via the browser's screen picker — nothing leaves this computer.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { Brand, Icon, P } from "./ui";

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

  useEffect(() => {
    try {
      localStorage.setItem("gug-live", source);
    } catch {
      /* private mode */
    }
  }, [source]);

  // Blender: refresh the viewport every 2 s while building (every 6 s otherwise).
  useEffect(() => {
    if (source !== "blender" || !auto) return;
    let alive = true;
    const pull = () =>
      api<typeof snap>("/api/live/blender")
        .then((s) => alive && (setSnap(s), setErr("")))
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
        {source === "window" && sharing ? (
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
        {(busy || latest) && (
          <div className="live-hud">
            {busy && <span className="live-dot">● LIVE</span>}
            {latest && <span className="mono live-act">▸ {latest.text}</span>}
          </div>
        )}
        {source === "blender" && snap && snap.scene.objects.length > 0 && (
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
