// Synthesised UI sounds — no audio files. Every interactive element gets a sound
// based on what it is; anything can override with data-sfx="name" (or "none").
export type Sfx = "tap" | "tab" | "toggle" | "nav" | "confirm" | "success" | "error" | "pulse" | "send" | "type" | "boot";
export interface SfxPrefs {
  muted: boolean;
  vol: number;
  pack: "synth" | "soft" | "click";
}

const KEY = "gug-sfx";
let prefs: SfxPrefs = { muted: false, vol: 0.6, pack: "synth" };
try {
  prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
} catch {
  /* storage unavailable: defaults */
}
const listeners = new Set<() => void>();
let ac: AudioContext | null = null;

export const getSfx = () => prefs;
export function setSfx(patch: Partial<SfxPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}
export const onSfxChange = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

export function play(kind: Sfx) {
  if (prefs.muted) return;
  try {
    ac ??= new AudioContext();
    if (ac.state === "suspended") void ac.resume();
    const ctx = ac;
    const now = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = prefs.vol * 0.5;
    out.connect(ctx.destination);
    const tone = (f1: number, f2: number, t0: number, dur: number, type: OscillatorType = "sine", g = 0.3) => {
      const o = ctx.createOscillator();
      const e = ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f1, now + t0);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + t0 + dur);
      e.gain.setValueAtTime(0.0001, now + t0);
      e.gain.exponentialRampToValueAtTime(g, now + t0 + 0.006);
      e.gain.exponentialRampToValueAtTime(0.0001, now + t0 + dur);
      o.connect(e).connect(out);
      o.start(now + t0);
      o.stop(now + t0 + dur + 0.03);
    };
    const noise = (t0: number, dur: number, f: number, q = 1, g = 0.2) => {
      const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
      const b = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = ctx.createBufferSource();
      src.buffer = b;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime(f, now + t0);
      bp.frequency.exponentialRampToValueAtTime(f * 3, now + t0 + dur);
      bp.Q.value = q;
      const e = ctx.createGain();
      e.gain.value = g;
      src.connect(bp).connect(e).connect(out);
      src.start(now + t0);
    };
    const soft = prefs.pack === "soft";
    const click = prefs.pack === "click";
    const K: Record<Sfx, () => void> = {
      tap: () => (click ? noise(0, 0.03, 3200, 2, 0.6) : tone(soft ? 520 : 880, soft ? 430 : 620, 0, 0.06, soft ? "sine" : "triangle", 0.22)),
      tab: () => { tone(660, 0, 0, 0.05, "triangle", 0.18); tone(990, 0, 0.045, 0.08, "triangle", 0.16); if (!soft) noise(0, 0.14, 700, 0.7, 0.07); },
      toggle: () => tone(440, 880, 0, 0.1, "sine", 0.24),
      nav: () => { noise(0, 0.24, 260, 0.8, 0.22); tone(120, 55, 0, 0.2, "sine", 0.32); },
      confirm: () => { tone(523, 0, 0, 0.08, "triangle", 0.2); tone(784, 0, 0.06, 0.1, "triangle", 0.18); tone(1046, 0, 0.12, 0.18, "sine", 0.15); },
      success: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0, i * 0.05, 0.3, "sine", 0.13)),
      error: () => { tone(220, 180, 0, 0.12, "square", 0.1); tone(196, 150, 0.13, 0.18, "square", 0.1); },
      pulse: () => { tone(90, 38, 0, 0.6, "sine", 0.6); noise(0, 0.5, 1200, 0.5, 0.12); tone(1760, 880, 0.02, 0.35, "sine", 0.06); },
      send: () => { tone(600, 1500, 0, 0.13, "sine", 0.2); noise(0, 0.16, 2000, 1, 0.06); },
      type: () => noise(0, 0.02, 4000, 3, 0.15),
      boot: () => { [196, 294, 392, 587].forEach((f, i) => tone(f, f * 1.01, i * 0.09, 0.5, "sine", 0.1)); noise(0, 0.6, 400, 0.4, 0.05); },
    };
    K[kind]();
  } catch {
    /* audio not available */
  }
}

export function installGlobalSfx() {
  document.addEventListener(
    "pointerdown",
    (ev) => {
      const t = ev.target as Element | null;
      if (!t?.closest) return;
      const tagged = t.closest("[data-sfx]");
      let k: string | null = null;
      if (tagged) k = tagged.getAttribute("data-sfx");
      else if (t.closest(".seg button, [role=tab]")) k = "tab";
      else if (t.closest(".switch, input[type=checkbox]")) k = "toggle";
      else if (t.closest(".rail a")) k = "nav";
      else if (t.closest(".btn-red")) k = "confirm";
      else if (t.closest(".btn-white")) k = "success";
      else if (t.closest("a")) k = "nav";
      else if (t.closest("button, .listbtn, .chip, select")) k = "tap";
      if (k && k !== "none") play(k as Sfx);
    },
    true,
  );
}
