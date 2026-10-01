// Flows: small automations that run agents on a schedule (or on demand) and
// deliver the result to your inbox or a Discord channel.
import { randomUUID } from "node:crypto";
import { agentById, systemFor } from "./agents.js";
import { runClaude } from "./engines/claude.js";
import type { GugEvent } from "./events.js";
import { HttpError, claudeKeys, vaultGet } from "./local.js";
import type { Store } from "./store.js";
import { TOOL_SYSTEM, toolsFor } from "./tools.js";

export type Trigger = { type: "manual" } | { type: "every"; minutes: number } | { type: "daily"; at: string } | { type: "weekly"; day: number; at: string };
export interface FlowStep {
  agent: string;
  prompt: string;
}
export interface FlowRun {
  at: string;
  ok: boolean;
  ms: number;
  output: string;
  trigger: "manual" | "schedule";
}
export interface Flow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Trigger;
  steps: FlowStep[];
  deliver: { inbox: boolean; discord: boolean };
  createdAt: string;
  lastRunAt?: string;
  runs: FlowRun[];
}
export interface InboxItem {
  id: string;
  flowId: string;
  title: string;
  body: string;
  at: string;
  read: boolean;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateFlow(input: any, existing?: Flow): Flow {
  const name = String(input?.name ?? "").trim().slice(0, 60);
  if (!name) throw new HttpError(400, "Give the flow a name.");
  const t = input?.trigger ?? { type: "manual" };
  let trigger: Trigger;
  if (t.type === "every") {
    const minutes = Math.round(Number(t.minutes));
    if (!(minutes >= 15 && minutes <= 24 * 60)) throw new HttpError(400, "Repeat every 15 minutes to 24 hours.");
    trigger = { type: "every", minutes };
  } else if (t.type === "daily") {
    if (!HHMM.test(String(t.at))) throw new HttpError(400, "Use a time like 08:00.");
    trigger = { type: "daily", at: String(t.at) };
  } else if (t.type === "weekly") {
    const day = Number(t.day);
    if (!(Number.isInteger(day) && day >= 0 && day <= 6)) throw new HttpError(400, "Pick a day of the week.");
    if (!HHMM.test(String(t.at))) throw new HttpError(400, "Use a time like 08:00.");
    trigger = { type: "weekly", day, at: String(t.at) };
  } else trigger = { type: "manual" };
  const steps: FlowStep[] = (Array.isArray(input?.steps) ? input.steps : []).slice(0, 5).map((s: any) => {
    const agent = String(s?.agent ?? "");
    if (!agentById(agent)) throw new HttpError(400, "Unknown agent in a step.");
    const prompt = String(s?.prompt ?? "").trim().slice(0, 4000);
    if (!prompt) throw new HttpError(400, "Every step needs instructions.");
    return { agent, prompt };
  });
  if (!steps.length) throw new HttpError(400, "Add at least one step.");
  return {
    id: existing?.id ?? randomUUID(),
    name,
    enabled: input?.enabled === undefined ? existing?.enabled ?? true : !!input.enabled,
    trigger,
    steps,
    deliver: { inbox: input?.deliver?.inbox !== false, discord: !!input?.deliver?.discord },
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastRunAt: existing?.lastRunAt,
    runs: existing?.runs ?? [],
  };
}

/** Is this flow due at `now`? Schedules never double-fire within the same slot. */
export function isDue(f: Flow, now: Date): boolean {
  if (!f.enabled) return false;
  const last = f.lastRunAt ? new Date(f.lastRunAt).getTime() : 0;
  if (f.trigger.type === "every") return now.getTime() - (last || new Date(f.createdAt).getTime()) >= f.trigger.minutes * 60_000;
  if (f.trigger.type === "daily" || f.trigger.type === "weekly") {
    const [h, m] = f.trigger.at.split(":").map(Number);
    const slot = new Date(now);
    if (f.trigger.type === "weekly") slot.setDate(slot.getDate() - ((slot.getDay() - f.trigger.day + 7) % 7)); // most recent such weekday
    slot.setHours(h, m, 0, 0);
    // Only fire within a day of the slot, so a laptop that was asleep all week doesn't run a stale job.
    return now >= slot && now.getTime() - slot.getTime() < 864e5 && last < slot.getTime();
  }
  return false;
}

const fill = (s: string, previous: string) =>
  s.replaceAll("{{date}}", new Date().toDateString()).replaceAll("{{time}}", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })).replaceAll("{{previous}}", previous);

/** Runs a flow's steps in order. Each step sees the previous step's output. */
export async function* runFlow(store: Store, f: Flow, trigger: "manual" | "schedule", signal?: AbortSignal): AsyncGenerator<GugEvent & { step?: number }> {
  const started = Date.now();
  let previous = "";
  let ok = true;
  for (let i = 0; i < f.steps.length; i++) {
    const s = f.steps[i];
    const agent = agentById(s.agent)!;
    const prompt = fill(s.prompt, previous) + (previous && !s.prompt.includes("{{previous}}") ? `\n\nOutput from the previous step:\n${previous}` : "");
    let out = "";
    // Flows run unattended, so agents may look things up but never change your data.
    const tools = toolsFor(store, agent.id).filter((t) => !t.writes);
    const system = tools.length ? `${systemFor(agent)}\n\n${TOOL_SYSTEM} This is a scheduled automation: your tools are read-only and nobody is watching live, so finish with the final result.\nToday is ${new Date().toDateString()}.` : systemFor(agent);
    for await (const ev of runClaude({ keys: claudeKeys(store), system, messages: [{ role: "user", content: prompt }], mode: "fast", agent: agent.id, signal, maxTokens: 4000, tools })) {
      if (ev.type === "text") out += ev.text;
      if (ev.type === "error") ok = false;
      yield { ...ev, step: i };
    }
    if (!ok) break;
    previous = out.trim();
  }
  const run: FlowRun = { at: new Date().toISOString(), ok, ms: Date.now() - started, output: previous.slice(0, 4000), trigger };
  f.lastRunAt = run.at;
  f.runs = [run, ...f.runs].slice(0, 20);
  if (ok && previous) {
    if (f.deliver.inbox) {
      store.data.inbox = [{ id: randomUUID(), flowId: f.id, title: f.name, body: previous, at: run.at, read: false }, ...(store.data.inbox ?? [])].slice(0, 100);
    }
    if (f.deliver.discord) {
      const hook = vaultGet(store, "discord_webhook");
      if (hook) {
        try {
          await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: `**${f.name}**\n${previous}`.slice(0, 1900), allowed_mentions: { parse: [] } }) });
          yield { type: "tool", name: "Discord", detail: "posted to your channel" };
        } catch {
          yield { type: "tool", name: "Discord", detail: "couldn’t post (check the webhook in Apps)" };
        }
      } else yield { type: "tool", name: "Discord", detail: "not connected — connect it in Apps" };
    }
  }
  store.save();
}

/** Checks every 30 seconds for due flows. One flow runs at a time. */
export function startScheduler(store: Store): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    const due = (store.data.flows ?? []).find((f) => isDue(f, new Date()));
    if (!due) return;
    running = true;
    try {
      for await (const _ of runFlow(store, due, "schedule")) {
        /* drain */
      }
    } catch (err) {
      console.error("flow failed:", err);
    } finally {
      running = false;
    }
  };
  const t = setInterval(() => void tick(), 30_000);
  return () => clearInterval(t);
}

export const TEMPLATES: Omit<Flow, "id" | "createdAt" | "runs">[] = [
  { name: "Morning plan", enabled: false, trigger: { type: "daily", at: "08:00" }, steps: [{ agent: "tempo", prompt: "It's {{date}}. Check today's posts, my automations and how much I focused yesterday, then write me a focused plan for today: 3 priorities, time blocks with breaks, and one thing to say no to. Keep it under 150 words." }], deliver: { inbox: true, discord: false } },
  { name: "Weekly content ideas", enabled: false, trigger: { type: "daily", at: "09:00" }, steps: [{ agent: "scout", prompt: "List 5 trending topics this week for a desk-setup / productivity audience, one line each." }, { agent: "echo", prompt: "Turn these into 5 short-form video ideas with a hook line each:\n{{previous}}" }], deliver: { inbox: true, discord: false } },
  { name: "Money check-in", enabled: false, trigger: { type: "weekly", day: 0, at: "18:00" }, steps: [{ agent: "ledger", prompt: "Weekly money check-in: look at my last 7 days in Ventures (compare with the week before), then give me 3 wins, 2 leaks to fix, and 1 thing to try next week. If I have no data yet, give me a 5-point checklist instead." }], deliver: { inbox: true, discord: false } },
  { name: "Security sweep", enabled: false, trigger: { type: "manual" }, steps: [{ agent: "sentinel", prompt: "Give me a 6-item monthly security checklist for my accounts, API keys and devices, most important first." }], deliver: { inbox: true, discord: false } },
];
