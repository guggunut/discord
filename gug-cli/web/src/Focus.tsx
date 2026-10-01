// Focus timer: work or study sprints from the top bar, with an optional
// ambient noise bed. The timer lives outside the page tree (and in
// localStorage) so it keeps running while you move between screens.
import { useEffect, useState } from "react";
import { api } from "./api";
import { play } from "./sfx";
import { Icon, P } from "./ui";

interface Timer {
  label: string;
  minutes: number;
  endsAt: number | null; // running
  left: number | null; // paused, ms remaining
  ambient: boolean;
}
const KEY = "gug-focus";
const load = (): Timer | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
let timer: Timer | null = load();
const listeners = new Set<() => void>();
const set = (t: Timer | null) => {
  timer = t;
  try {
    if (t) localStorage.setItem(KEY, JSON.stringify(t));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode */
  }
  listeners.forEach((l) => l());
};

// ---- ambient brown noise (synthesised, nothing downloaded) ----
let noise: { ctx: AudioContext; gain: GainNode } | null = null;
function ambient(on: boolean) {
  if (on && !noise) {
    const ctx = new AudioContext();
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 1.5);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
    noise = { ctx, gain };
  } else if (!on && noise) {
    const n = noise;
    noise = null;
    n.gain.gain.linearRampToValueAtTime(0, n.ctx.currentTime + 0.6);
    setTimeout(() => void n.ctx.close(), 700);
  }
}

const remaining = (t: Timer) => (t.endsAt ? Math.max(0, t.endsAt - Date.now()) : t.left ?? t.minutes * 60_000);
const fmt = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Mount once: ticks the timer, finishes sessions and logs them. */
export function FocusEngine({ toast }: { toast: (t: string) => void }) {
  useEffect(() => {
    const tick = () => {
      const t = timer;
      if (!t?.endsAt || t.endsAt > Date.now()) return;
      ambient(false);
      set(null);
      play("success");
      toast(`Focus session done — ${t.minutes} minutes${t.label ? ` on “${t.label}”` : ""}. Take a break.`);
      void api("/api/focus", { body: { minutes: t.minutes, label: t.label } }).catch(() => {});
      if (localStorage.getItem("gug-notify") === "1" && typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Focus session done", { body: `${t.minutes} minutes${t.label ? ` · ${t.label}` : ""}. Stand up and stretch.`, icon: "/icon-192.png" });
    };
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

function useTimer() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    const id = window.setInterval(l, 1000);
    return () => {
      listeners.delete(l);
      window.clearInterval(id);
    };
  }, []);
  return timer;
}

/** The pill in the top bar and its popover. */
export function FocusPill() {
  const t = useTimer();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [stats, setStats] = useState<{ today: number; week: number; streak: number } | null>(null);
  useEffect(() => {
    if (open) void api<{ today: number; week: number; streak: number }>("/api/focus").then(setStats).catch(() => {});
  }, [open]);

  const start = (minutes: number) => {
    play("confirm");
    set({ label: label.trim().slice(0, 60), minutes, endsAt: Date.now() + minutes * 60_000, left: null, ambient: false });
    setOpen(false);
  };
  const ms = t ? remaining(t) : 0;
  const pct = t ? 1 - ms / (t.minutes * 60_000) : 0;
  const R = 9;
  const C = 2 * Math.PI * R;

  return (
    <div style={{ position: "relative" }}>
      <button type="button" className="btn" aria-expanded={open} aria-label={t ? `Focus timer, ${fmt(ms)} left` : "Start a focus session"} title="Focus timer" onClick={() => setOpen(!open)} style={{ height: 44, gap: 8, padding: "0 12px", borderColor: t ? "rgba(255,43,58,0.5)" : undefined }}>
        <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
          <circle cx="11" cy="11" r={R} fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="2" />
          {t && <circle cx="11" cy="11" r={R} fill="none" stroke="#FF2B3A" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${C * pct} ${C}`} transform="rotate(-90 11 11)" style={{ filter: "drop-shadow(0 0 3px #FF2B3A)" }} />}
          {!t && <path d="M11 6v5l3 2" stroke="#A1A1AA" strokeWidth="1.6" fill="none" strokeLinecap="round" />}
        </svg>
        <span className="mono" style={{ fontSize: 12, color: t ? "#F4F4F5" : "#A1A1AA" }}>{t ? fmt(ms) : "Focus"}</span>
        {t && !t.endsAt && <span className="mono" style={{ fontSize: 9, color: "#FF5A66" }}>PAUSED</span>}
      </button>
      {open && (
        <div className="card pop" role="dialog" aria-label="Focus timer" style={{ position: "absolute", right: 0, top: 52, zIndex: 60, width: 290, padding: 16, display: "flex", flexDirection: "column", gap: 12, borderColor: "rgba(255,43,58,0.4)" }}>
          {t ? (
            <>
              <div className="disp" style={{ fontSize: 40, fontWeight: 300, textAlign: "center" }}>{fmt(ms)}</div>
              {t.label && <div className="muted" style={{ textAlign: "center", fontSize: 13, marginTop: -6 }}>{t.label}</div>}
              <div className="row" style={{ gap: 6 }}>
                {t.endsAt ? (
                  <button type="button" className="btn" style={{ flex: 1 }} onClick={() => set({ ...t, endsAt: null, left: remaining(t) })}>Pause</button>
                ) : (
                  <button type="button" className="btn btn-white" style={{ flex: 1 }} onClick={() => set({ ...t, endsAt: Date.now() + (t.left ?? 0), left: null })}>Resume</button>
                )}
                <button type="button" className="btn" style={{ flex: 1, color: "#FF5A66" }} onClick={() => (ambient(false), set(null))}>Stop</button>
              </div>
              <label className="row" style={{ gap: 10, fontSize: 13 }}>
                <input type="checkbox" checked={!!noise} onChange={(e) => (ambient(e.target.checked), set({ ...t, ambient: e.target.checked }))} style={{ accentColor: "#FF2B3A", width: 16, height: 16, margin: 0 }} />
                Ambient brown noise
              </label>
            </>
          ) : (
            <>
              <input aria-label="What are you focusing on?" className="field" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="What are you working on?" style={{ height: 40, fontSize: 13 }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                {[25, 50, 90].map((m) => (
                  <button key={m} type="button" className={`btn ${m === 25 ? "btn-red" : ""}`} data-sfx="none" style={{ height: 52, flexDirection: "column", gap: 0 }} onClick={() => start(m)}>
                    <b style={{ fontSize: 16 }}>{m}</b>
                    <span style={{ fontSize: 10, opacity: 0.8 }}>min</span>
                  </button>
                ))}
              </div>
            </>
          )}
          {stats && (
            <div className="row mono muted" style={{ fontSize: 10, justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
              <span>TODAY {stats.today}m</span>
              <span>WEEK {stats.week}m</span>
              <span>{stats.streak} DAY STREAK</span>
            </div>
          )}
          <div className="row muted" style={{ fontSize: 11, gap: 6 }}>
            <Icon d={P.check} size={12} /> Tempo and Sage can see your focus time.
          </div>
        </div>
      )}
    </div>
  );
}
