// A small JSON-file database. Writes are coalesced and atomic (temp file + rename).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EngineId } from "./agents.js";
import type { Sealed } from "./crypto.js";
import type { Flow, InboxItem } from "./flows.js";

export interface Prefs {
  engine: EngineId;
  codePermission: "acceptEdits" | "plan";
  localUrl: string;
  localModel: string;
  agents: Record<string, { engine?: EngineId; autonomy?: "ask" | "spend" | "full"; enabled?: boolean }>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  at: string;
  engine?: string;
  model?: string;
}

export interface DB {
  version: 2;
  profile: { name: string; createdAt: string };
  prefs: Prefs;
  secrets: Record<string, Sealed>;
  chats: Record<string, ChatMessage[]>;
  flows: Flow[];
  inbox: InboxItem[];
}

export const defaultPrefs = (): Prefs => ({ engine: "auto", codePermission: "acceptEdits", localUrl: "http://127.0.0.1:11434", localModel: "", agents: {} });

const empty = (): DB => ({ version: 2, profile: { name: "", createdAt: new Date().toISOString() }, prefs: defaultPrefs(), secrets: {}, chats: {}, flows: [], inbox: [] });

export class Store {
  data: DB;
  private file: string;
  private pending: NodeJS.Timeout | null = null;

  constructor(file: string) {
    this.file = file;
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const loaded = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const base = empty();
    this.data = { ...base, ...(loaded.version === 2 ? loaded : {}), prefs: { ...base.prefs, ...(loaded.version === 2 ? loaded.prefs : {}) } };
  }

  save(): void {
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.flush();
    }, 50);
  }

  flush(): void {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}
