// Real 3D bar charts: CSS-3D boxes standing on a tilted floor. Drag to orbit,
// hover to lift a bar and read it, click to pin. Negative values are white.
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { play } from "./sfx";

export interface Bar3D {
  label: string;
  value: number;
  /** Optional stacked parts (value is then their sum); colours cycle red → white → grey. */
  parts?: { name: string; value: number }[];
  sub?: string;
}

const PART_COLORS = [
  ["#FF3B4A", "#B3001A", "#FF7C86"],
  ["#F4F4F5", "#A1A1AA", "#FFFFFF"],
  ["#71717A", "#3F3F46", "#A1A1AA"],
];
const NEG = ["#E4E4E7", "#71717A", "#FFFFFF"];

export function Bars3D({ data, format, height = 230, empty = "Nothing to show yet." }: { data: Bar3D[]; format: (n: number) => string; height?: number; empty?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const [sw, setSw] = useState(420);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSw(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const maxHeight = height * 0.5;
  const [yaw, setYaw] = useState(-14);
  const [tilt, setTilt] = useState(58);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; yaw: number; tilt: number; moved: number } | null>(null);
  const n = data.length;
  // Size bars so the whole floor fits the card at the default angle.
  const w = Math.max(8, Math.min(46, Math.min(sw * 0.62, 460) / (Math.max(1, n) * 1.45 + 0.45)));
  const gap = w * 0.45;
  const depth = w;
  const floorW = n * (w + gap) + gap;
  const floorD = depth + 34;
  const max = useMemo(() => Math.max(1e-9, ...data.map((d) => Math.abs(d.value))), [data]);
  const focus = pinned ?? hover ?? (n ? n - 1 : null);
  const f = focus !== null ? data[focus] : null;

  const down = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, yaw, tilt, moved: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
    setYaw(Math.max(-80, Math.min(80, d.yaw + dx * 0.35)));
    setTilt(Math.max(20, Math.min(75, d.tilt - dy * 0.3)));
  };
  const up = () => {
    drag.current = null;
  };

  if (!n) return <div className="muted" style={{ fontSize: 13, height, display: "grid", placeItems: "center" }}>{empty}</div>;
  return (
    <div ref={stage} className="b3-stage" style={{ height }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={() => (setYaw(-14), setTilt(58))} role="img" aria-label={`3D bar chart. ${data.map((d) => `${d.label}: ${format(d.value)}`).join(", ")}`}>
      {f && (
        <div className="b3-hud">
          <span className="mono" style={{ fontSize: 10, letterSpacing: ".12em", color: "#A1A1AA" }}>{f.label.toUpperCase()}{pinned !== null ? " · PINNED" : ""}</span>
          <b className="disp" style={{ fontSize: 22, fontWeight: 300, color: f.value < 0 ? "#F4F4F5" : "#FF2B3A" }}>{format(f.value)}</b>
          {f.parts && f.parts.length > 1 && f.parts.map((p, i) => (
            <span key={p.name} className="mono" style={{ fontSize: 10, color: "#A1A1AA" }}>
              <i style={{ display: "inline-block", width: 7, height: 7, borderRadius: 2, background: PART_COLORS[i % 3][0], marginRight: 6 }} />
              {p.name} {format(p.value)}
            </span>
          ))}
          {f.sub && <span className="muted" style={{ fontSize: 10.5, maxWidth: 260 }}>{f.sub}</span>}
        </div>
      )}
      <span className="mono b3-hint">DRAG TO ORBIT · CLICK A BAR TO PIN</span>
      <div className="b3-floor" style={{ width: floorW, height: floorD, transform: `translateY(${height * 0.2}px) rotateX(${tilt}deg) rotateZ(${yaw}deg)` }}>
        {data.map((d, i) => {
          const h = Math.max(2, (Math.abs(d.value) / max) * maxHeight);
          const lifted = hover === i || pinned === i;
          const dim = focus !== null && (hover !== null || pinned !== null) && !lifted;
          const parts = d.parts && d.parts.length ? d.parts.filter((p) => p.value > 0) : [{ name: d.label, value: Math.abs(d.value) }];
          const total = parts.reduce((a, p) => a + p.value, 0) || 1;
          let z = 0;
          return (
            <div
              key={d.label + i}
              className={`b3-bar ${lifted ? "lift" : ""} ${dim ? "dim" : ""}`}
              style={{ left: gap + i * (w + gap), top: 8, width: w, height: depth, ["--d" as string]: `${0.08 + i * 0.035}s` }}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((x) => (x === i ? null : x))}
              onClick={(e) => {
                if (drag.current && drag.current.moved > 4) return;
                e.stopPropagation();
                play("tap");
                setPinned((p) => (p === i ? null : i));
              }}
            >
              {parts.map((p, k) => {
                const ph = (p.value / total) * h;
                const c = d.value < 0 ? NEG : PART_COLORS[k % 3];
                const seg = (
                  <div key={p.name} className="b3-seg" style={{ transform: `translateZ(${z}px)` }}>
                    <i className="b3-front" style={{ width: w, height: ph, background: `linear-gradient(180deg, ${c[1]}, ${c[0]})` }} />
                    <i className="b3-side" style={{ width: ph, height: depth, left: w, background: `linear-gradient(90deg, ${c[1]}, ${c[1]}cc)` }} />
                    {k === parts.length - 1 && <i className="b3-top" style={{ width: w, height: depth, transform: `translateZ(${ph}px)`, background: c[2] }} />}
                  </div>
                );
                z += ph;
                return seg;
              })}
              <span className="b3-label mono" style={{ width: w + gap, left: -gap / 2 }}>{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
