// Local engine: talks to an Ollama-compatible server on this machine.
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import type { GugEvent } from "../events.js";

export function isLoopbackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === "http:" || u.protocol === "https:") && ["127.0.0.1", "localhost", "[::1]", "::1"].includes(u.hostname);
  } catch {
    return false;
  }
}

export async function* runLocal(opts: { url: string; model: string; system: string; messages: { role: "user" | "assistant"; content: string }[]; signal?: AbortSignal; agent?: string }): AsyncGenerator<GugEvent> {
  // Only loopback addresses: a user-supplied URL must never let the server reach other hosts.
  if (!isLoopbackUrl(opts.url)) {
    yield { type: "error", message: "Local models must run on this machine (localhost)." };
    return;
  }
  if (!opts.model) {
    yield { type: "error", message: "Pick a local model in Settings → Engines (for example one you pulled with `ollama pull`)." };
    return;
  }
  let res: Response;
  try {
    res = await fetch(new URL("/api/chat", opts.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: opts.model, stream: true, messages: [{ role: "system", content: opts.system }, ...opts.messages] }),
      signal: opts.signal,
    });
  } catch {
    yield { type: "error", message: `Couldn’t reach a local model at ${opts.url}. Is Ollama running?` };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", message: `Local model error (${res.status}).` };
    return;
  }
  yield { type: "start", engine: "local", model: opts.model, agent: opts.agent };
  const rl = createInterface({ input: Readable.fromWeb(res.body as any) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.message?.content) yield { type: "text", text: j.message.content, agent: opts.agent };
      if (j.done) break;
    } catch {
      /* ignore partial lines */
    }
  }
  yield { type: "done", engine: "local", model: opts.model, agent: opts.agent };
}
