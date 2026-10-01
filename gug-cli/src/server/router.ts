// Decides which engine handles a job, and runs single-agent chats and multi-agent roundtables.
import { agentById, AGENTS, systemFor, type AgentPreset, type EngineId } from "./agents.js";
import { runClaude, type Mode } from "./engines/claude.js";
import { runClaudeCode } from "./engines/claudeCode.js";
import { runLocal } from "./engines/local.js";
import type { GugEvent } from "./events.js";
import { claudeKeys } from "./local.js";
import type { Store } from "./store.js";
import { TOOL_SYSTEM, toolsFor } from "./tools.js";
import { parseFileBlocks, projectDir, VIBE_SYSTEM, writeFile } from "./workspace.js";

const CODE_WORDS = /\b(fix|refactor|test|tests|bug|build|compile|commit|repo|repository|function|component|endpoint|deploy|lint|typescript|python|javascript|code)\b/i;

/** Auto routing: code work in a project goes to Claude Code, private/offline to local, the rest to Claude. */
export function pickEngine(task: string, opts: { preferred: EngineId; hasProject: boolean; codeReady: boolean; localReady: boolean }): Exclude<EngineId, "auto"> {
  if (opts.preferred !== "auto") return opts.preferred;
  if (opts.codeReady && opts.hasProject && CODE_WORDS.test(task)) return "code";
  if (opts.localReady && /\b(offline|private|locally)\b/i.test(task)) return "local";
  return "claude";
}

function history(store: Store, agentId: string): { role: "user" | "assistant"; content: string }[] {
  return (store.data.chats[agentId] ?? []).slice(-20).map((m) => ({ role: m.role, content: m.content }));
}

export function remember(store: Store, agentId: string, role: "user" | "assistant", content: string, extra: { engine?: string; model?: string } = {}) {
  const list = (store.data.chats[agentId] ??= []);
  list.push({ role, content, at: new Date().toISOString(), ...extra });
  if (list.length > 300) list.splice(0, list.length - 300);
  store.save();
}

export interface ChatInput {
  agentId: string;
  text: string;
  mode: Mode;
  engine: EngineId;
  project?: string;
  codeReady: boolean;
  signal?: AbortSignal;
}

/** One agent, one message. Streams events and stores the conversation. */
export async function* chat(store: Store, input: ChatInput): AsyncGenerator<GugEvent> {
  const agent = agentById(input.agentId);
  if (!agent) {
    yield { type: "error", message: "Unknown agent." };
    return;
  }
  const prefs = store.data.prefs;
  const preferred = input.engine !== "auto" ? input.engine : prefs.agents[agent.id]?.engine ?? agent.engine;
  const engine = pickEngine(input.text, { preferred, hasProject: true, codeReady: input.codeReady, localReady: !!prefs.localModel });

  const past = history(store, agent.id);
  remember(store, agent.id, "user", input.text);
  let reply = "";
  let model: string | undefined;

  let source: AsyncGenerator<GugEvent>;
  if (engine === "code") {
    source = runClaudeCode({ prompt: input.text, cwd: projectDir(input.project || "playground"), apiKey: claudeKeys(store)[0], permission: prefs.codePermission, system: agent.system, signal: input.signal });
  } else if (engine === "local") {
    source = runLocal({ url: prefs.localUrl, model: prefs.localModel, system: systemFor(agent), messages: [...past, { role: "user", content: input.text }], signal: input.signal, agent: agent.id });
  } else {
    const tools = toolsFor(store, agent.id);
    source = runClaude({ keys: claudeKeys(store), system: tools.length ? `${systemFor(agent)}\n\n${TOOL_SYSTEM}\nToday is ${new Date().toDateString()}.` : systemFor(agent), messages: [...past, { role: "user", content: input.text }], mode: input.mode, agent: agent.id, signal: input.signal, tools });
  }

  for await (const ev of source) {
    if (ev.type === "text") reply += ev.text;
    if (ev.type === "start" && ev.model) model = ev.model;
    yield { ...ev, agent: agent.id } as GugEvent;
  }
  if (reply.trim()) remember(store, agent.id, "assistant", reply, { engine, model });
}

/**
 * Agents talking to each other: each agent answers in turn and sees what the
 * others said. In debate mode a second pass critiques, then Atlas sums up.
 */
export async function* roundtable(keys: string[], ids: string[], prompt: string, mode: Mode, signal?: AbortSignal, store?: Store): AsyncGenerator<GugEvent> {
  const agents = ids.map(agentById).filter((a): a is AgentPreset => !!a).slice(0, 6);
  if (!agents.length) {
    yield { type: "error", message: "Pick at least one agent." };
    return;
  }
  const transcript: string[] = [];
  const turn = async function* (agent: AgentPreset, instruction: string): AsyncGenerator<GugEvent> {
    const context = transcript.length ? `\n\nWhat the other agents have said so far:\n${transcript.join("\n\n")}` : "";
    let said = "";
    // In a group, agents may look things up (read-only) but never change your data.
    const tools = store ? toolsFor(store, agent.id).filter((t) => !t.writes) : [];
    const system = tools.length ? `${systemFor(agent)}\n\n${TOOL_SYSTEM} In this group discussion your tools are read-only.\nToday is ${new Date().toDateString()}.` : systemFor(agent);
    for await (const ev of runClaude({ keys, system, messages: [{ role: "user", content: `${instruction}${context}` }], mode: mode === "debate" ? "deep" : mode, agent: agent.id, signal, maxTokens: 4000, tools })) {
      if (ev.type === "text") said += ev.text;
      yield ev;
    }
    if (said.trim()) transcript.push(`${agent.name} (${agent.role}): ${said.trim()}`);
  };

  for (const a of agents) {
    if (signal?.aborted) return;
    yield* turn(a, `The user asked: "${prompt}". Answer from your role as ${a.role}, in under 150 words. Build on the other agents rather than repeating them.`);
  }
  if (mode === "debate" && agents.length > 1) {
    for (const a of agents) {
      if (signal?.aborted) return;
      yield* turn(a, `Critique the weakest point in the other agents' answers to "${prompt}" in under 80 words, and say what you'd change.`);
    }
  }
  if (agents.length > 1 || mode === "debate") {
    yield* turn(AGENTS[0], `Summarise the team's answer to "${prompt}" as: the plan (3 bullets), who owns each part, and the one decision the user must make.`);
  }
}

/**
 * Team mode: Atlas reads the request, hands a specific task to each of the
 * right agents, they do their part (with their tools), and Atlas combines it.
 */
export async function* team(store: Store, ids: string[], prompt: string, signal?: AbortSignal): AsyncGenerator<GugEvent> {
  const keys = claudeKeys(store);
  const atlas = AGENTS[0];
  const chosen = ids.map(agentById).filter((a): a is AgentPreset => !!a && a.id !== "atlas" && a.id !== "forge");
  const pool = chosen.length ? chosen : AGENTS.filter((a) => a.id !== "atlas" && a.id !== "forge");

  // 1. Atlas plans (quietly — we show the plan, not the JSON).
  yield { type: "tool", name: "Atlas", detail: "planning who does what…", agent: "atlas" };
  let raw = "";
  let model: string | undefined;
  for await (const ev of runClaude({
    keys,
    system: `${systemFor(atlas)}\n\nYou are planning work for your team. Reply with ONLY JSON: {"assignments":[{"agent":"<id>","task":"<one concrete instruction, 1-2 sentences>"}]}. Use 1 to 4 agents, only from this list, each at most once, in the order the work should happen:\n${pool.map((a) => `- ${a.id}: ${a.role}`).join("\n")}`,
    messages: [{ role: "user", content: prompt }],
    mode: "fast",
    agent: "atlas",
    signal,
    maxTokens: 1200,
  })) {
    if (ev.type === "text") raw += ev.text;
    else if (ev.type === "start") model = ev.model;
    else if (ev.type === "error") return yield ev;
  }
  let plan: { agent: AgentPreset; task: string }[] = [];
  try {
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    const seen = new Set<string>();
    for (const x of Array.isArray(j.assignments) ? j.assignments : []) {
      const a = pool.find((p) => p.id === String(x?.agent));
      const task = String(x?.task ?? "").trim().slice(0, 600);
      if (a && task && !seen.has(a.id)) {
        seen.add(a.id);
        plan.push({ agent: a, task });
      }
    }
  } catch {
    /* fall back below */
  }
  if (!plan.length) plan = (chosen.length ? chosen : pool.slice(0, 2)).slice(0, 4).map((agent) => ({ agent, task: `From your role as ${agent.role}: ${prompt}` }));
  plan = plan.slice(0, 4);
  yield { type: "start", engine: "claude", model, agent: "atlas" };
  yield { type: "text", agent: "atlas", text: `**Here’s the plan.**\n\n${plan.map((p, i) => `${i + 1}. **${p.agent.name}** — ${p.task}`).join("\n")}` };
  yield { type: "done", engine: "claude", model, agent: "atlas" };

  // 2. Each agent does its part, seeing what the others delivered.
  const delivered: string[] = [];
  for (const { agent, task } of plan) {
    if (signal?.aborted) return;
    const tools = toolsFor(store, agent.id);
    const context = delivered.length ? `\n\nWhat your teammates have delivered so far:\n${delivered.join("\n\n")}` : "";
    const system = tools.length ? `${systemFor(agent)}\n\n${TOOL_SYSTEM}\nToday is ${new Date().toDateString()}.` : systemFor(agent);
    let said = "";
    for await (const ev of runClaude({ keys, system, messages: [{ role: "user", content: `The user asked the team: "${prompt}"\n\nAtlas gave you this part: ${task}\nDo it now — concrete output, not a description of what you'd do. Under 200 words.${context}` }], mode: "deep", agent: agent.id, signal, maxTokens: 4000, tools })) {
      if (ev.type === "text") said += ev.text;
      yield ev;
    }
    if (said.trim()) delivered.push(`${agent.name} (${agent.role}): ${said.trim()}`);
  }

  // 3. Atlas pulls it together.
  if (signal?.aborted || !delivered.length) return;
  yield* runClaude({ keys, system: systemFor(atlas), messages: [{ role: "user", content: `The user asked: "${prompt}". Your team delivered:\n\n${delivered.join("\n\n")}\n\nCombine it into one answer: what's done, what the user should do next (max 3 steps), and the one decision they need to make. Under 160 words.` }], mode: "deep", agent: "atlas", signal, maxTokens: 2000 });
}

/** Vibe coding through the Claude API: the model writes whole files, we save them. */
export async function* vibeWithClaude(keys: string[], project: string, prompt: string, files: { path: string; content: string }[], signal?: AbortSignal): AsyncGenerator<GugEvent> {
  const dir = projectDir(project);
  const context = files.map((f) => `<file path="${f.path}">\n${f.content}</file>`).join("\n");
  let full = "";
  for await (const ev of runClaude({ keys, system: `${VIBE_SYSTEM}\n\nCurrent project files:\n${context || "(empty project)"}`, messages: [{ role: "user", content: prompt }], mode: "build", agent: "forge", signal })) {
    if (ev.type === "text") full += ev.text;
    if (ev.type === "done") {
      const written: string[] = [];
      for (const b of parseFileBlocks(full)) {
        try {
          writeFile(dir, b.path, b.content);
          written.push(b.path);
          yield { type: "tool", name: "Write", detail: b.path, agent: "forge" };
        } catch (err) {
          yield { type: "tool", name: "Skipped", detail: `${b.path} — ${(err as Error).message}`, agent: "forge" };
        }
      }
      if (written.length) yield { type: "files", paths: written };
    }
    yield ev;
  }
}
