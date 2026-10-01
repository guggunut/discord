// Local API tokens: let your own scripts on this computer (a Discord bot, a
// shortcut, a cron job) ask GUG-cli's agents a question. Tokens are shown once,
// stored only as hashes, can only *ask* (agents get read-only tools), and are
// rate limited.
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { agentById, systemFor } from "./agents.js";
import { randomToken, sha256 } from "./crypto.js";
import { runClaude, type Mode } from "./engines/claude.js";
import { HttpError, claudeKeys } from "./local.js";
import type { Store } from "./store.js";
import { TOOL_SYSTEM, toolsFor } from "./tools.js";

export interface ApiToken {
  id: string;
  name: string;
  hash: string;
  createdAt: string;
  lastUsedAt?: string;
  uses: number;
}

export function createToken(store: Store, name: string): { token: string; info: Omit<ApiToken, "hash"> } {
  const n = name.trim().slice(0, 40) || "My script";
  if (store.data.tokens.length >= 10) throw new HttpError(400, "You already have 10 tokens — revoke one first.");
  const token = `gug_${randomToken(24)}`;
  const t: ApiToken = { id: randomUUID(), name: n, hash: sha256(token), createdAt: new Date().toISOString(), uses: 0 };
  store.data.tokens.push(t);
  store.save();
  const { hash: _, ...info } = t;
  return { token, info };
}

export const listTokens = (store: Store) => store.data.tokens.map(({ hash: _, ...t }) => t);

const windows = new Map<string, number[]>();
const LIMIT = 30; // requests per minute per token

/** Bearer-token auth for /api/v1. Sets res.locals.token. */
export function bearer(store: Store) {
  return (req: Request, res: Response, next: NextFunction) => {
    const m = /^Bearer\s+(gug_[\w-]{20,})$/.exec(req.get("authorization") ?? "");
    const t = m && store.data.tokens.find((x) => x.hash === sha256(m[1]));
    if (!t) return next(new HttpError(401, "Missing or unknown API token. Create one in GUG-cli → Apps → Local API."));
    const now = Date.now();
    const recent = (windows.get(t.id) ?? []).filter((x) => now - x < 60_000);
    if (recent.length >= LIMIT) return next(new HttpError(429, "Slow down — 30 requests a minute per token."));
    recent.push(now);
    windows.set(t.id, recent);
    t.uses++;
    t.lastUsedAt = new Date().toISOString();
    store.save();
    res.locals.token = t;
    next();
  };
}

/** One question to one agent; returns the whole answer as JSON. */
export async function ask(store: Store, input: { agent?: unknown; text?: unknown; mode?: unknown }, signal?: AbortSignal) {
  const agent = agentById(typeof input.agent === "string" ? input.agent : "atlas");
  if (!agent) throw new HttpError(400, "Unknown agent.");
  const text = typeof input.text === "string" ? input.text.trim().slice(0, 4000) : "";
  if (!text) throw new HttpError(400, "Send some text to ask.");
  const mode: Mode = input.mode === "deep" ? "deep" : "fast";
  const tools = toolsFor(store, agent.id).filter((t) => !t.writes);
  const system = `${systemFor(agent)}\n\n${tools.length ? `${TOOL_SYSTEM} Your tools are read-only here.\n` : ""}This request comes from one of the user's own scripts (for example a chat bot), so answer in plain text under 1500 characters.`;
  let reply = "";
  let model: string | undefined;
  const used: string[] = [];
  for await (const ev of runClaude({ keys: claudeKeys(store), system, messages: [{ role: "user", content: text }], mode, agent: agent.id, signal, maxTokens: 1500, tools })) {
    if (ev.type === "text") reply += ev.text;
    else if (ev.type === "start") model = ev.model;
    else if (ev.type === "tool") used.push(ev.name);
    else if (ev.type === "error") throw new HttpError(502, ev.message);
  }
  return { agent: agent.id, text: reply.trim(), model, tools: used };
}
