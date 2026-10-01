// Shared memory: an "About you" note plus short facts, given to every agent.
// The user writes and deletes these; agents only add facts when asked to remember.
import { randomUUID } from "node:crypto";
import { HttpError } from "./local.js";
import type { Store } from "./store.js";

export interface Fact {
  id: string;
  text: string;
  at: string;
  by: string; // "you" or an agent id
}
export interface Memory {
  about: string;
  facts: Fact[];
}
export const emptyMemory = (): Memory => ({ about: "", facts: [] });

export function addFact(store: Store, text: string, by: string): Fact {
  const t = text.trim().replace(/\s+/g, " ").slice(0, 300);
  if (!t) throw new HttpError(400, "Nothing to remember.");
  const m = store.data.memory;
  const dupe = m.facts.find((f) => f.text.toLowerCase() === t.toLowerCase());
  if (dupe) return dupe;
  if (m.facts.length >= 100) throw new HttpError(400, "Memory is full (100 facts) — delete a few first.");
  const f = { id: randomUUID(), text: t, at: new Date().toISOString(), by };
  m.facts.push(f);
  store.save();
  return f;
}

/** The block appended to every agent's instructions. Empty when there's nothing to say. */
export function memoryText(store: Store): string {
  const m = store.data.memory;
  if (!m.about.trim() && !m.facts.length) return "";
  const lines = ["What the user has told GUG-cli about themselves (use it to personalise answers; don't repeat it back unprompted):"];
  if (m.about.trim()) lines.push(`About them: ${m.about.trim().slice(0, 2000)}`);
  if (m.facts.length) lines.push("Things to remember:", ...m.facts.slice(-60).map((f) => `- ${f.text}`));
  return lines.join("\n");
}
