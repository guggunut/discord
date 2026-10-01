// Claude Code engine: runs the `claude` CLI headless inside a project folder and
// turns its stream-json output into GUG events.
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { GugEvent } from "../events.js";

let cached: { ok: boolean; version: string } | null = null;
let resolved: { cmd: string; pre: string[] } | null = null;

/**
 * How to start Claude Code. On Windows, npm installs it as `claude.cmd`, which
 * Node can't spawn without a shell — so we run its cli.js with Node directly,
 * or the native `claude.exe` if that's what's installed.
 */
export function resolveClaude(): { cmd: string; pre: string[] } {
  if (resolved) return resolved;
  if (process.platform !== "win32") return (resolved = { cmd: "claude", pre: [] });
  try {
    const hits = execFileSync("where", ["claude"], { encoding: "utf8", timeout: 5000 }).split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const exe = hits.find((h) => h.toLowerCase().endsWith(".exe"));
    if (exe) return (resolved = { cmd: exe, pre: [] });
    for (const h of hits) {
      const cli = path.join(path.dirname(h), "node_modules", "@anthropic-ai", "claude-code", "cli.js");
      if (existsSync(cli)) return (resolved = { cmd: process.execPath, pre: [cli] });
    }
  } catch {
    /* not on PATH */
  }
  return (resolved = { cmd: "claude", pre: [] });
}

export function detectClaudeCode(): Promise<{ ok: boolean; version: string }> {
  if (cached) return Promise.resolve(cached);
  const { cmd, pre } = resolveClaude();
  return new Promise((resolve) => {
    execFile(cmd, [...pre, "--version"], { timeout: 8000 }, (err, stdout) => {
      cached = err ? { ok: false, version: "" } : { ok: true, version: stdout.trim() };
      resolve(cached);
    });
  });
}

/** Commands Claude Code may run without asking. Anything else is refused in headless mode. */
export const SAFE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash(npm test:*)", "Bash(npm run *)", "Bash(node *)", "Bash(ls *)", "Bash(git status)", "Bash(git diff *)", "Bash(git log *)"];

function summarizeTool(name: string, input: Record<string, unknown>): string {
  const pick = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.name ?? input.object_name ?? input.code ?? "";
  return String(typeof pick === "string" ? pick : JSON.stringify(pick)).replace(/\s+/g, " ").slice(0, 160);
}

export interface CodeRun {
  prompt: string;
  cwd: string;
  apiKey?: string;
  permission: "acceptEdits" | "plan";
  system?: string;
  signal?: AbortSignal;
  /** Path to an MCP config file and the server names Claude Code may use from it. */
  mcp?: { configPath: string; servers: string[] };
}

export async function* runClaudeCode(run: CodeRun): AsyncGenerator<GugEvent> {
  const det = await detectClaudeCode();
  if (!det.ok) {
    yield { type: "error", message: "Claude Code isn’t installed on this machine. Install it with `npm install -g @anthropic-ai/claude-code`, run `claude` once to sign in, then try again." };
    return;
  }
  const tools = [...SAFE_TOOLS, ...(run.mcp?.servers ?? []).map((n) => `mcp__${n}`)];
  const args = ["-p", run.prompt, "--output-format", "stream-json", "--verbose", "--permission-mode", run.permission, "--allowedTools", tools.join(",")];
  if (run.mcp?.servers.length) args.push("--mcp-config", run.mcp.configPath);
  if (run.system) args.push("--append-system-prompt", run.system);
  const env = { ...process.env };
  if (run.apiKey) env.ANTHROPIC_API_KEY = run.apiKey; // otherwise Claude Code uses its own sign-in
  const { cmd, pre } = resolveClaude();
  const child = spawn(cmd, [...pre, ...args], { cwd: run.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const kill = () => child.kill("SIGTERM");
  run.signal?.addEventListener("abort", kill, { once: true });

  let stderr = "";
  child.on("error", (e) => (stderr += ` ${e.message}`)); // e.g. the binary vanished — reported below instead of crashing
  child.stderr.on("data", (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
  const exited = new Promise<number>((resolve) => child.on("close", (code) => resolve(code ?? 0)));

  yield { type: "start", engine: "claude-code" };
  let finished = false;
  const rl = createInterface({ input: child.stdout });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "system" && msg.subtype === "init") {
      yield { type: "start", engine: "claude-code", model: msg.model };
    } else if (msg.type === "assistant" && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === "text" && block.text) yield { type: "text", text: block.text + "\n\n" };
        if (block.type === "tool_use") yield { type: "tool", name: block.name, detail: summarizeTool(block.name, block.input ?? {}) };
      }
    } else if (msg.type === "result") {
      finished = true;
      if (msg.is_error) yield { type: "error", message: String(msg.result ?? "Claude Code reported an error.") };
      else yield { type: "done", engine: "claude-code", costUsd: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : undefined };
    }
  }
  const code = await exited;
  run.signal?.removeEventListener("abort", kill);
  if (!finished && !run.signal?.aborted) {
    yield { type: "error", message: `Claude Code stopped (exit ${code}). ${stderr.trim().split("\n").slice(-2).join(" ")}`.trim() };
  }
}
