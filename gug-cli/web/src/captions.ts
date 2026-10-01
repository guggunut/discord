// Caption helpers for the Shorts maker (pure, shared with the tests).

/** Splits a script into short caption lines of about `words` words, at sentence breaks where possible. */
export function toLines(script: string, words = 6): string[] {
  const out: string[] = [];
  for (const sentence of script.replace(/\s+/g, " ").split(/(?<=[.!?])\s+/)) {
    const w = sentence.trim().split(" ").filter(Boolean);
    for (let i = 0; i < w.length; i += words) out.push(w.slice(i, i + words).join(" "));
  }
  return out.filter(Boolean).slice(0, 30);
}
