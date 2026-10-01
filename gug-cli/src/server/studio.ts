// Studio: Muse draws vector artwork (SVG) and Vox writes voiceover scripts.
// Artwork is saved to <data>/studio and only ever shown as an image, served
// with a sandboxing CSP, after stripping anything active from the markup.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { agentById, systemFor } from "./agents.js";
import { config } from "./config.js";
import { runClaude } from "./engines/claude.js";
import type { GugEvent } from "./events.js";
import { HttpError, claudeKeys } from "./local.js";
import type { Store } from "./store.js";

export interface Artwork {
  id: string;
  title: string;
  prompt: string;
  style: string;
  at: string;
  bytes: number;
}
export interface Studio {
  art: Artwork[];
}
export const emptyStudio = (): Studio => ({ art: [] });

export const STYLES: Record<string, string> = {
  neon: "Dark background (#030303), glowing signal-red (#FF2B3A) and white line work, subtle grid, cinematic.",
  minimal: "Flat, minimal, generous negative space, black and white with one red accent.",
  poster: "Bold Swiss-style poster: big geometric shapes, strong typography if text is requested, high contrast.",
  isometric: "Isometric 3D illustration with clean faces, soft gradients and long shadows.",
  logo: "A simple, memorable logo mark centred on a plain background, works at small sizes.",
  pattern: "A seamless, decorative pattern that fills the whole canvas.",
};

const studioDir = () => path.join(config.dataDir, "studio");
const fileFor = (id: string) => {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new HttpError(400, "Bad artwork id.");
  return path.join(studioDir(), `${id}.svg`);
};

/** Removes scripts, event handlers, external references and embedded HTML from an SVG. */
export function sanitizeSvg(raw: string): string {
  const m = raw.match(/<svg[\s\S]*<\/svg>/i);
  if (!m) throw new HttpError(502, "Muse didn't return an SVG. Try rephrasing.");
  let s = m[0];
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  for (const tag of ["script", "foreignObject", "iframe", "object", "embed", "audio", "video", "handler", "listener", "animation"]) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "").replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  s = s.replace(/\s(on[a-z]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Only allow in-document references (#id) and data: images; drop everything else.
  s = s.replace(/\s((?:xlink:)?href)\s*=\s*("([^"]*)"|'([^']*)')/gi, (all, _attr, _q, a, b) => {
    const v = (a ?? b ?? "").trim();
    return v.startsWith("#") || /^data:image\/(png|jpeg|gif|webp);base64,/i.test(v) ? all : "";
  });
  s = s.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, "none");
  s = s.replace(/@import[^;]*;?/gi, "");
  s = s.replace(/javascript:/gi, "");
  if (!/\sxmlns=/.test(s.slice(0, 300))) s = s.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (s.length > 400_000) throw new HttpError(502, "That artwork came back too large.");
  return s;
}

const MUSE_SVG = `You are drawing for the user as an SVG artist.
Reply with exactly one complete <svg> element and nothing else — no prose, no code fences.
Rules: viewBox="0 0 1024 1024", width="1024" height="1024", self-contained (no external images, fonts or links), no <script>, no event handlers, no <foreignObject>.
Use gradients, filters, paths and shapes for rich detail. Keep it under 60 KB.`;

/** Muse draws an SVG. Streams progress, then saves the result to the gallery. */
export async function* drawWithMuse(store: Store, prompt: string, style: string, signal?: AbortSignal): AsyncGenerator<GugEvent | { type: "art"; art: Artwork }> {
  const look = STYLES[style] ?? STYLES.neon;
  let out = "";
  let failed = false;
  const muse = agentById("muse")!;
  for await (const ev of runClaude({ keys: claudeKeys(store), system: `${systemFor(muse)}\n\n${MUSE_SVG}`, messages: [{ role: "user", content: `Draw: ${prompt}\nStyle: ${look}` }], mode: "build", agent: "muse", signal, maxTokens: 24_000 })) {
    if (ev.type === "text") {
      out += ev.text;
      yield { type: "tool", name: "Muse", detail: `drawing… ${Math.round(out.length / 1024)} KB` };
      continue;
    }
    if (ev.type === "error") failed = true;
    yield ev;
  }
  if (failed || signal?.aborted) return;
  const svg = sanitizeSvg(out);
  const art: Artwork = { id: randomUUID(), title: prompt.slice(0, 60), prompt, style, at: new Date().toISOString(), bytes: svg.length };
  mkdirSync(studioDir(), { recursive: true, mode: 0o700 });
  writeFileSync(fileFor(art.id), svg, { mode: 0o600 });
  store.data.studio.art = [art, ...store.data.studio.art].slice(0, 200);
  store.save();
  yield { type: "art", art };
}

export function readArt(id: string): string {
  const f = fileFor(id);
  if (!existsSync(f)) throw new HttpError(404, "Artwork not found.");
  return readFileSync(f, "utf8");
}

export function deleteArt(store: Store, id: string) {
  rmSync(fileFor(id), { force: true });
  store.data.studio.art = store.data.studio.art.filter((a) => a.id !== id);
  store.save();
}

/** Vox writes a script sized for the requested length (about 150 spoken words a minute). */
export async function* scriptWithVox(store: Store, topic: string, seconds: number, tone: string, signal?: AbortSignal): AsyncGenerator<GugEvent> {
  const words = Math.max(20, Math.round((seconds / 60) * 150));
  const prompt = `Write a voiceover script about: ${topic}\nTone: ${tone || "warm and confident"}. Length: about ${words} words (${seconds} seconds spoken).\nReturn only the words to be spoken — no stage directions, headings or quotes. Use short sentences and natural pauses (commas, full stops).`;
  yield* runClaude({ keys: claudeKeys(store), system: systemFor(agentById("vox")!), messages: [{ role: "user", content: prompt }], mode: "fast", agent: "vox", signal, maxTokens: 2000 });
}
