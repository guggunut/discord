// The 3D core: a CSS-3D gyroscope with an octahedron crystal (or a tesseract in
// Build mode). Drag to spin, click to pulse.
import { useRef, useState, type PointerEvent } from "react";
import { play } from "./sfx";
import { Sigil } from "./ui";

export type CoreMode = "fast" | "deep" | "debate" | "build";

const A = "35.26deg";
const TOP = [
  "linear-gradient(180deg,rgba(255,140,150,.85),rgba(255,43,58,.55))",
  "linear-gradient(180deg,rgba(255,90,100,.7),rgba(140,0,20,.6))",
  "linear-gradient(180deg,rgba(255,200,205,.8),rgba(255,43,58,.45))",
  "linear-gradient(180deg,rgba(220,30,50,.75),rgba(70,0,10,.7))",
];
const BOT = [
  "linear-gradient(0deg,rgba(40,0,6,.85),rgba(255,43,58,.5))",
  "linear-gradient(0deg,rgba(90,0,14,.8),rgba(255,90,100,.55))",
  "linear-gradient(0deg,rgba(20,0,3,.9),rgba(200,20,40,.5))",
  "linear-gradient(0deg,rgba(60,0,10,.85),rgba(255,120,130,.5))",
];
const CUBE_FACES = ["rotateY(0deg)", "rotateY(90deg)", "rotateY(180deg)", "rotateY(-90deg)", "rotateX(90deg)", "rotateX(-90deg)"];

export function Core({ mode, busy, voice, label, height = 380, crew = [], active }: { mode: CoreMode; busy: boolean; voice: boolean; label: string; height?: number; crew?: string[]; active?: string }) {
  const [rot, setRot] = useState({ x: -16, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [bursts, setBursts] = useState(0);
  const [boost, setBoost] = useState(false);
  const drag = useRef<{ x: number; y: number; rx: number; ry: number; moved: number } | null>(null);
  const timers = useRef<number[]>([]);

  const pulse = () => {
    play("pulse");
    setBursts((b) => b + 1);
    setBoost(true);
    timers.current.push(window.setTimeout(() => setBoost(false), 2400));
  };
  const down = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, rx: rot.x, ry: rot.y, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDragging(true);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    setRot({ x: Math.max(-75, Math.min(75, d.rx - dy * 0.45)), y: d.ry + dx * 0.55 });
  };
  const up = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (d.moved < 5) pulse();
    timers.current.push(window.setTimeout(() => setRot((r) => ({ x: -16, y: Math.round(r.y / 360) * 360 })), 1600));
  };

  const spin = boost ? "3s" : { fast: "7s", deep: "24s", debate: "14s", build: "18s" }[mode];
  const faceZ = mode === "debate" ? "96px" : busy || boost ? "66px" : "55px";
  const build = mode === "build";

  return (
    <div
      className="card stage drag"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      role="img"
      aria-label={`AI core — ${label}. Drag to rotate, click to pulse.`}
      style={{ height, borderRadius: 26, background: "radial-gradient(ellipse at 50% 40%, rgba(255,43,58,0.10), transparent 60%), linear-gradient(180deg, #0B0B0C, #050505)" }}
    >
      <div className="floor" />
      <div className="flare" />
      {voice && (
        <>
          <span className="ripple" />
          <span className="ripple b" />
          <span className="ripple c" />
        </>
      )}
      {bursts > 0 && (
        <span key={bursts}>
          <span className="burst" />
          <span className="burst r" />
        </span>
      )}
      <div style={{ transform: `scale(${Math.min(1, (height - 40) / 340)})`, transformStyle: "preserve-3d", transition: "transform .6s cubic-bezier(.7,0,.2,1)" }}>
      <div className={`gwrap ${dragging ? "" : "spring"}`} style={{ transform: `rotateX(${rot.x}deg) rotateY(${rot.y}deg) scale(${boost ? 1.12 : 1})` }}>
        <div className="octa-glow" />
        <div className="octa" style={{ animationDuration: boost ? "2.4s" : mode === "fast" ? "6s" : "14s", opacity: build ? 0 : 1, transition: "opacity .5s" }}>
          {[0, 1, 2, 3].map((k) => (
            <i key={`t${k}`} className="t" style={{ transform: `rotateY(${k * 90}deg) translateZ(${faceZ}) rotateX(${A})`, background: TOP[k] }} />
          ))}
          {[0, 1, 2, 3].map((k) => (
            <i key={`b${k}`} className="b" style={{ transform: `rotateY(${k * 90}deg) translateZ(${faceZ}) rotateX(-${A})`, background: BOT[k] }} />
          ))}
        </div>
        {build && (
          <div className="shape-in" style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d" }}>
            <div className="cube">{CUBE_FACES.map((f) => <b key={f} style={{ transform: `${f} translateZ(62px)` }} />)}</div>
            <div className="cube in">{CUBE_FACES.map((f) => <b key={f} style={{ transform: `${f} translateZ(30px)` }} />)}</div>
          </div>
        )}
        <div className="gyro" style={{ animationDuration: spin }}>
          {[0, 30, 60, 90, 120, 150].map((d) => (
            <div key={d} className="ring" style={{ transform: `rotateY(${d}deg)` }} />
          ))}
          <div className="ring r" style={{ transform: "rotateX(90deg)" }} />
        </div>
        <div className="orb" style={{ inset: -34, transform: "rotateX(74deg) rotateY(14deg)" }}>
          <div className="spinz" style={{ border: "1px solid rgba(255,43,58,0.55)" }}>
            <span className="sat" />
          </div>
        </div>
        <div className="orb" style={{ inset: -58, transform: "rotateX(64deg) rotateY(-30deg)" }}>
          <div className="spinz rev" style={{ border: "1px dashed rgba(255,255,255,0.28)" }}>
            <span className="sat w" />
          </div>
        </div>
      </div>
      </div>
      {crew.length > 1 && (
        // The selected agents orbit the core; whoever is talking lights up.
        <div className={`crew ${busy ? "busy" : ""}`} aria-hidden="true">
          {crew.map((id, i) => {
            const a = (i / crew.length) * 360;
            return (
              <span key={id} className={`crew-m ${active === id ? "on" : ""}`} style={{ transform: `rotate(${a}deg) translate(min(${Math.round(height * 0.38)}px, 30vw)) rotate(${-a}deg)` }}>
                <span className="crew-in">
                  <Sigil id={id} size={30} glow={active === id} />
                </span>
              </span>
            );
          })}
        </div>
      )}
      <span className="hud" style={{ left: 14, top: 14, borderTopWidth: 1, borderLeftWidth: 1 }} />
      <span className="hud" style={{ right: 14, top: 14, borderTopWidth: 1, borderRightWidth: 1 }} />
      <span className="hud" style={{ left: 14, bottom: 14, borderBottomWidth: 1, borderLeftWidth: 1 }} />
      <span className="hud" style={{ right: 14, bottom: 14, borderBottomWidth: 1, borderRightWidth: 1 }} />
      <div className="mono hide-sm" style={{ position: "absolute", left: 0, right: 0, top: 22, textAlign: "center", fontSize: 10, letterSpacing: ".16em", color: "#71717A", pointerEvents: "none" }}>
        DRAG TO ROTATE · CLICK TO PULSE
      </div>
      <div className="mono hide-sm" style={{ position: "absolute", left: 24, bottom: 22, fontSize: 10, letterSpacing: ".14em", color: "#A1A1AA", lineHeight: 1.8 }}>
        MODE · {mode.toUpperCase()}
        <br />
        <span style={{ color: "#F4F4F5" }}>{{ fast: "QUICK SPIN · HAIKU FIRST", deep: "SLOW ORBIT · OPUS 5.5", debate: "CRYSTAL SPLIT · AGENTS ARGUE", build: "TESSERACT · CLAUDE CODE" }[mode]}</span>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 20, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10, height: 34, padding: "0 16px", borderRadius: 999, background: "rgba(5,5,5,0.75)", border: "1px solid rgba(255,255,255,0.12)", backdropFilter: "blur(10px)", fontSize: 12, fontWeight: 500 }}>
          <span className="blink" style={{ width: 7, height: 7, borderRadius: "50%", background: "#FF2B3A", boxShadow: "0 0 10px #FF2B3A" }} />
          {label}
        </span>
      </div>
    </div>
  );
}
