// Thin client for the GUG-cli server.
export type GugEvent =
  | { type: "start"; engine: string; model?: string; agent?: string }
  | { type: "text"; text: string; agent?: string }
  | { type: "tool"; name: string; detail: string; agent?: string }
  | { type: "fallback"; from: string; to?: string; reason: string }
  | { type: "files"; paths: string[] }
  | { type: "done"; engine: string; model?: string; agent?: string; costUsd?: number }
  | { type: "error"; message: string; agent?: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: opts.method ?? (opts.body ? "POST" : "GET"),
    headers: { "content-type": "application/json", "x-gug-request": "1" },
    credentials: "same-origin",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** POSTs and reads a server-sent event stream. Returns an abort function. */
export function stream(path: string, body: unknown, onEvent: (e: GugEvent) => void, onEnd?: () => void): () => void {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-gug-request": "1" }, body: JSON.stringify(body), signal: ac.signal });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        onEvent({ type: "error", message: j.error ?? `Request failed (${res.status})` });
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const line of chunk.split("\n")) if (line.startsWith("data: ")) onEvent(JSON.parse(line.slice(6)));
        }
      }
    } catch (err) {
      if (!ac.signal.aborted) onEvent({ type: "error", message: err instanceof Error ? err.message : "Connection lost." });
    } finally {
      onEnd?.();
    }
  })();
  return () => ac.abort();
}

export interface Me {
  user: { id: string; email: string; handle: string; name: string; isOwner: boolean; twoFactor: boolean; recoveryLeft: number; createdAt: string; prefs: any };
  group: Group | null;
  engines: { canHost: boolean; claudeCode: { ok: boolean; version: string }; claudeKeys: number };
  vault: { name: string; preview: string }[];
}

export interface Group {
  id: string;
  name: string;
  code?: string;
  isHost: boolean;
  members: { handle: string; isHost: boolean; isYou: boolean }[];
  room: { handle: string; text: string; at: string }[];
}
