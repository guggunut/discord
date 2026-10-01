// Now playing: reads and controls the music on this computer through the server's media bridge.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { api, type NowPlaying } from "./api";
import { Icon } from "./ui";

type Action = "toggle" | "next" | "prev" | "back10" | "fwd10" | "seek";
interface MediaCtx {
  np: NowPlaying | null;
  position: number;
  act: (a: Action, to?: number) => void;
  busy: boolean;
}
const Ctx = createContext<MediaCtx>({ np: null, position: 0, act: () => {}, busy: false });
export const useMedia = () => useContext(Ctx);

export function MediaProvider({ children }: { children: ReactNode }) {
  const [np, setNp] = useState<NowPlaying | null>(null);
  const [position, setPosition] = useState(0);
  const [busy, setBusy] = useState(false);
  const base = useRef({ pos: 0, at: Date.now(), playing: false, duration: 0 });

  const accept = useCallback((v: NowPlaying) => {
    setNp(v);
    base.current = { pos: v.position, at: Date.now(), playing: v.playing, duration: v.duration };
    setPosition(v.position);
  }, []);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const poll = async () => {
      if (document.visibilityState === "visible") {
        try {
          const v = await api<NowPlaying>("/api/media");
          if (alive) accept(v);
        } catch {
          /* ignore */
        }
      }
      if (alive) timer = window.setTimeout(poll, 3000);
    };
    void poll();
    // Smooth progress between polls.
    const tick = window.setInterval(() => {
      const b = base.current;
      if (!b.playing) return;
      const p = b.pos + (Date.now() - b.at) / 1000;
      setPosition(b.duration ? Math.min(p, b.duration) : p);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [accept]);

  const act = useCallback(
    async (a: Action, to?: number) => {
      setBusy(true);
      if (a === "toggle") base.current = { ...base.current, pos: base.current.pos + (Date.now() - base.current.at) / 1000, at: Date.now(), playing: !base.current.playing };
      try {
        accept(await api<NowPlaying>(`/api/media/${a}`, { body: { to } }));
      } catch {
        /* keep the last known state */
      } finally {
        setBusy(false);
      }
    },
    [accept],
  );

  return <Ctx.Provider value={{ np, position, act, busy }}>{children}</Ctx.Provider>;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const PREV = "M6 5h2v14H6zM20 5v14L9 12z";
const NEXT = "M16 5h2v14h-2zM4 5v14l11-7z";
const PLAY = "M8 5l11 7-11 7z";
const PAUSE = "M6 5h4v14H6zM14 5h4v14h-4z";
const Filled = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d={d} />
  </svg>
);

export function MiniPlayer() {
  const { np, act } = useMedia();
  if (!np?.active) return null;
  return (
    <div className="card hide-sm" style={{ display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 6px 0 12px", borderRadius: 14, maxWidth: 300 }}>
      <span className={`eqmini ${np.playing ? "on" : ""}`} aria-hidden="true">
        <i /> <i /> <i />
      </span>
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{np.title}</span>
        <span style={{ fontSize: 11, color: "#A1A1AA", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{np.artist}</span>
      </span>
      <button type="button" className="mbtn" style={{ width: 32, height: 32 }} aria-label={np.playing ? "Pause" : "Play"} data-sfx="toggle" onClick={() => act("toggle")}>
        <Filled d={np.playing ? PAUSE : PLAY} size={13} />
      </button>
      <button type="button" className="mbtn" style={{ width: 32, height: 32 }} aria-label="Next track" onClick={() => act("next")}>
        <Filled d={NEXT} size={12} />
      </button>
    </div>
  );
}

export function MediaCard() {
  const { np, position, act, busy } = useMedia();
  const active = !!np?.active;
  const pct = active && np!.duration ? (position / np!.duration) * 100 : 0;
  return (
    <div className="card hot" style={{ padding: 18, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <h2 className="disp" style={{ margin: 0, fontSize: 14, fontWeight: 400 }}>
          Now playing
        </h2>
        {active && <span className="chip" style={{ height: 26 }}>{np!.app}</span>}
      </div>
      {!active ? (
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <div className="vinyl" style={{ animationPlayState: "paused", opacity: 0.5 }} />
          <div style={{ fontSize: 13, color: "#A1A1AA", lineHeight: 1.55 }}>{np?.hint ?? "Checking your media player…"}</div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div className="vinyl" style={{ animationPlayState: np!.playing ? "running" : "paused" }} />
              <span className="tonearm" style={{ transform: np!.playing ? "rotate(-28deg)" : "rotate(-6deg)" }} />
            </div>
            <div style={{ minWidth: 0, flexGrow: 1 }} key={np!.title} className="tx-slide">
              <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{np!.title}</div>
              <div style={{ fontSize: 13, color: "#A1A1AA", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{np!.artist}</div>
              <div className={`mwave ${np!.playing ? "on" : ""}`} aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 26, marginTop: 10 }}>
                {Array.from({ length: 28 }, (_, i) => (
                  <span key={i} style={{ height: `${30 + 70 * Math.abs(Math.sin(i * 0.9) * Math.cos(i * 0.37))}%`, animationDelay: `${(i % 7) * 0.08}s` }} />
                ))}
              </div>
            </div>
          </div>
          <label className="sr" htmlFor="scrub">
            Seek
          </label>
          <input id="scrub" className="scrub" type="range" min={0} max={Math.max(1, Math.round(np!.duration))} value={Math.round(position)} disabled={!np!.canSeek} onChange={(e) => act("seek", Number(e.target.value))} style={{ ["--p" as string]: `${pct}%`, marginTop: 16 }} />
          <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#A1A1AA", marginTop: 6 }}>
            <span>{fmt(position)}</span>
            <span>{np!.duration ? `-${fmt(Math.max(0, np!.duration - position))}` : "live"}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 12, opacity: busy ? 0.7 : 1 }}>
            <button type="button" className="mbtn" aria-label="Previous track" onClick={() => act("prev")}>
              <Filled d={PREV} />
            </button>
            <button type="button" className="mbtn" aria-label="Back 10 seconds" disabled={!np!.canSeek} onClick={() => act("back10")}>
              <Icon d="M11 6L5 12l6 6M19 6l-6 6 6 6" size={15} />
            </button>
            <button type="button" className="mbtn big" aria-label={np!.playing ? "Pause" : "Play"} data-sfx="toggle" onClick={() => act("toggle")}>
              <Filled d={np!.playing ? PAUSE : PLAY} size={20} />
            </button>
            <button type="button" className="mbtn" aria-label="Forward 10 seconds" disabled={!np!.canSeek} onClick={() => act("fwd10")}>
              <Icon d="M13 6l6 6-6 6M5 6l6 6-6 6" size={15} />
            </button>
            <button type="button" className="mbtn" aria-label="Next track" onClick={() => act("next")}>
              <Filled d={NEXT} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
