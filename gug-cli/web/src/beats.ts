// A tiny drum machine + bass synth on Web Audio. Patterns are 16 steps per
// track; the same scheduler plays them live, records them, and scores Shorts.

export type Track = "kick" | "snare" | "hat" | "clap" | "bass";
export const TRACKS: Track[] = ["kick", "snare", "hat", "clap", "bass"];
export interface Pattern {
  name: string;
  bpm: number;
  swing: number; // 0..0.5 — delay on every second 16th
  steps: Record<Track, boolean[]>;
  /** Semitone offset per step for the bass line (relative to A1). */
  notes: number[];
}

const row = (s: string) => s.split("").map((c) => c === "x");
export const PRESETS: Pattern[] = [
  { name: "Lo-fi", bpm: 82, swing: 0.18, steps: { kick: row("x.....x...x....."), snare: row("....x.......x..."), hat: row("x.x.x.x.x.x.x.xx"), clap: row("................"), bass: row("x.....x...x....x") }, notes: [0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 5, 0, 0, 0, 0, 7] },
  { name: "Trap", bpm: 140, swing: 0, steps: { kick: row("x......x..x....."), snare: row("........x......."), hat: row("xxxxxxxxxxxxxxxx"), clap: row("........x......."), bass: row("x......x..x....x") }, notes: [0, 0, 0, 0, 0, 0, 0, -2, 0, 0, 3, 0, 0, 0, 0, 5] },
  { name: "House", bpm: 124, swing: 0.05, steps: { kick: row("x...x...x...x..."), snare: row("................"), hat: row("..x...x...x...x."), clap: row("....x.......x..."), bass: row("..x...x...x...xx") }, notes: [0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 5, 0, 0, 0, 3, 5] },
  { name: "Drill", bpm: 142, swing: 0, steps: { kick: row("x.....x.......x."), snare: row("....x.......x..."), hat: row("x..x..x.x..x..x."), clap: row("................"), bass: row("x.....x.......x.") }, notes: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, -2, 0] },
];

export const clonePattern = (p: Pattern): Pattern => JSON.parse(JSON.stringify(p));
export const stepSeconds = (p: Pattern) => 60 / p.bpm / 4;

function noiseBuffer(ac: BaseAudioContext) {
  const b = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
const buffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Schedules one hit of `track` at time `t` into `out`. */
export function hit(ac: BaseAudioContext, out: AudioNode, track: Track, t: number, note = 0) {
  const noise = buffers.get(ac) ?? (buffers.set(ac, noiseBuffer(ac)), buffers.get(ac)!);
  const env = (g: GainNode, peak: number, len: number) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  };
  if (track === "kick") {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    env(g, 1, 0.32);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.35);
  } else if (track === "snare" || track === "clap" || track === "hat") {
    const n = ac.createBufferSource();
    n.buffer = noise;
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    if (track === "hat") {
      f.type = "highpass";
      f.frequency.value = 7000;
      env(g, 0.25, 0.05);
    } else if (track === "snare") {
      f.type = "bandpass";
      f.frequency.value = 1800;
      env(g, 0.6, 0.18);
      const o = ac.createOscillator();
      const og = ac.createGain();
      o.frequency.value = 190;
      env(og, 0.35, 0.09);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 0.12);
    } else {
      f.type = "bandpass";
      f.frequency.value = 1200;
      f.Q.value = 1.5;
      env(g, 0.55, 0.22);
    }
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.3);
  } else {
    const o = ac.createOscillator();
    const f = ac.createBiquadFilter();
    const g = ac.createGain();
    o.type = "sawtooth";
    o.frequency.value = 55 * 2 ** (note / 12);
    f.type = "lowpass";
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(160, t + 0.25);
    env(g, 0.45, 0.3);
    o.connect(f).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.32);
  }
}

/** Schedules `bars` bars of the pattern starting at `t0`. Returns the end time. */
export function schedule(ac: BaseAudioContext, out: AudioNode, p: Pattern, t0: number, bars = 1, onStep?: (step: number, at: number) => void): number {
  const st = stepSeconds(p);
  for (let b = 0; b < bars; b++) {
    for (let i = 0; i < 16; i++) {
      const t = t0 + (b * 16 + i) * st + (i % 2 ? p.swing * st : 0);
      for (const tr of TRACKS) if (p.steps[tr][i]) hit(ac, out, tr, t, p.notes[i] ?? 0);
      onStep?.(i, t);
    }
  }
  return t0 + bars * 16 * st;
}

/** The beat the user saved in Studio, if any (used by the Shorts maker). */
export function savedBeat(): Pattern | null {
  try {
    const p = JSON.parse(localStorage.getItem("gug-beat") ?? "null");
    return p && p.steps && TRACKS.every((t) => Array.isArray(p.steps[t]) && p.steps[t].length === 16) ? p : null;
  } catch {
    return null;
  }
}
