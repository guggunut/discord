// Claude (cloud API) engine with a fallback chain.
//
// - Rate limits, overloads, server errors and network failures move to the next
//   key, then the next model — as long as nothing has streamed yet.
// - Policy refusals on Opus/Sonnet are handled server-side with `fallbacks: "default"`.
import Anthropic from "@anthropic-ai/sdk";
import type { GugEvent } from "../events.js";
import type { AgentTool } from "../tools.js";

export type Mode = "fast" | "deep" | "debate" | "build";

interface Step {
  model: string;
  effort: boolean; // supports output_config.effort
  fallbacks: boolean; // supports the server-side refusal fallback
}

const OPUS: Step = { model: "claude-opus-5-5", effort: true, fallbacks: true };
const SONNET: Step = { model: "claude-sonnet-5-5", effort: true, fallbacks: true };
const HAIKU: Step = { model: "claude-haiku-4-5", effort: false, fallbacks: false };

export function chainFor(mode: Mode): Step[] {
  return mode === "fast" ? [HAIKU, SONNET, OPUS] : [OPUS, SONNET, HAIKU];
}

export function isRetryable(err: unknown): boolean {
  if (err instanceof Anthropic.RateLimitError) return true;
  if (err instanceof Anthropic.InternalServerError) return true; // 5xx, including 529 overloaded
  if (err instanceof Anthropic.APIConnectionError) return true; // includes timeouts
  if (err instanceof Anthropic.AuthenticationError) return true; // try the next key
  if (err instanceof Anthropic.PermissionDeniedError) return true;
  if (err instanceof Anthropic.APIError && (err.status === 408 || err.status === 409)) return true;
  return false;
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return "rate limited";
  if (err instanceof Anthropic.AuthenticationError) return "key rejected";
  if (err instanceof Anthropic.PermissionDeniedError) return "key lacks access";
  if (err instanceof Anthropic.InternalServerError) return `server busy (${err.status})`;
  if (err instanceof Anthropic.APIConnectionError) return "network error";
  if (err instanceof Anthropic.BadRequestError) return `bad request: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `API error ${err.status}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

export interface ClaudeRun {
  keys: string[];
  system: string;
  messages: Anthropic.Beta.Messages.BetaMessageParam[];
  mode: Mode;
  agent?: string;
  signal?: AbortSignal;
  maxTokens?: number;
  /** Client tools the model may call; results are fed back until it answers. */
  tools?: AgentTool[];
}

const MAX_TOOL_TURNS = 8;

/** One model call, for the router's usage panel. */
export interface Usage {
  at: string;
  model: string;
  key: number; // 1-based key slot
  agent?: string;
  input: number;
  output: number;
  ms: number;
  outcome: "ok" | "fallback" | "error";
  reason?: string;
}
let usageSink: (u: Usage) => void = () => {};
export const setUsageSink = (fn: (u: Usage) => void) => void (usageSink = fn);

// Key+model pairs that just hit a limit are skipped until they cool down, so the
// next request goes straight to something that works instead of waiting on a 429.
const cooling = new Map<string, number>();
const fp = (key: string) => key.slice(-10);
const coolId = (key: string, model: string) => `${fp(key)}:${model}`;
export function cooldownFor(err: unknown): number {
  if (err instanceof Anthropic.RateLimitError) {
    const ra = Number(err.headers?.get?.("retry-after"));
    return Math.min(300, Number.isFinite(ra) && ra > 0 ? ra : 30) * 1000;
  }
  if (err instanceof Anthropic.InternalServerError) return 15_000;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return 10 * 60_000;
  return 0;
}
/** What's cooling down right now, for the given keys (slots are 1-based). */
export function coolingStatus(keys: string[]): { key: number; model: string; seconds: number }[] {
  const now = Date.now();
  const out: { key: number; model: string; seconds: number }[] = [];
  for (const [id, until] of cooling) {
    if (until <= now) {
      cooling.delete(id);
      continue;
    }
    const [f, model] = [id.slice(0, id.lastIndexOf(":")), id.slice(id.lastIndexOf(":") + 1)];
    const k = keys.findIndex((x) => fp(x) === f);
    if (k >= 0) out.push({ key: k + 1, model, seconds: Math.ceil((until - now) / 1000) });
  }
  return out;
}
export const resetCooling = () => cooling.clear();

export async function* runClaude(run: ClaudeRun): AsyncGenerator<GugEvent> {
  if (run.keys.length === 0) {
    yield { type: "error", agent: run.agent, message: "No Claude API key yet. Add one in Settings → API keys (or the Setup guide)." };
    return;
  }
  const chain = chainFor(run.mode);
  const labelOf = (step: Step, k: number) => (run.keys.length > 1 ? `${step.model} (key ${k + 1})` : step.model);
  // Every model × key, in preference order, with anything cooling down moved to the back.
  const all = chain.flatMap((step) => run.keys.map((_, k) => ({ step, k })));
  const isCool = (a: { step: Step; k: number }) => (cooling.get(coolId(run.keys[a.k], a.step.model)) ?? 0) > Date.now();
  const attempts = [...all.filter((a) => !isCool(a)), ...all.filter(isCool)];
  let previous: string | undefined;
  let reason = "";
  if (attempts[0] !== all[0]) {
    previous = labelOf(all[0].step, all[0].k);
    reason = "cooling down after a recent limit";
  }
  for (const [n, { step, k }] of attempts.entries()) {
    {
      // The chain is the retry: move on at once, and only let the SDK retry the last option.
      const client = new Anthropic({ apiKey: run.keys[k], maxRetries: n === attempts.length - 1 ? 1 : 0 });
      const label = labelOf(step, k);
      if (previous) yield { type: "fallback", from: previous, to: label, reason };
      let emitted = false;
      const started = Date.now();
      let input = 0;
      let output = 0;
      try {
        const messages = [...run.messages];
        const defs = run.tools?.map((t) => t.def);
        for (let turn = 0; ; turn++) {
          if (turn >= MAX_TOOL_TURNS) {
            yield { type: "error", agent: run.agent, message: "Stopped after too many tool steps." };
            return;
          }
          const stream = client.beta.messages.stream(
            {
              model: step.model,
              max_tokens: run.maxTokens ?? (step === HAIKU ? 32000 : 64000),
              system: run.system,
              messages,
              ...(defs?.length ? { tools: defs } : {}),
              ...(step.effort ? { output_config: { effort: run.mode === "fast" ? "low" : run.mode === "deep" ? "high" : "medium" } } : {}),
              ...(step.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
            },
            { signal: run.signal },
          );
          if (turn === 0) yield { type: "start", engine: "claude", model: step.model, agent: run.agent };
          for await (const ev of stream) {
            if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
              emitted = true;
              yield { type: "text", text: ev.delta.text, agent: run.agent };
            } else if (ev.type === "content_block_start" && ev.content_block.type === "fallback") {
              yield { type: "fallback", from: step.model, to: "safety fallback model", reason: "request declined by the first model" };
            }
          }
          const final = await stream.finalMessage();
          input += final.usage?.input_tokens ?? 0;
          output += final.usage?.output_tokens ?? 0;
          if (final.stop_reason === "refusal") {
            usageSink({ at: new Date().toISOString(), model: step.model, key: k + 1, agent: run.agent, input, output, ms: Date.now() - started, outcome: "error", reason: "refused" });
            yield { type: "error", agent: run.agent, message: "Claude declined this request." };
            return;
          }
          if (final.stop_reason === "tool_use" && run.tools?.length) {
            // Tools can change data, so from here on we never replay this turn on another model.
            emitted = true;
            const uses = final.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
            messages.push({ role: "assistant", content: final.content.filter((b) => b.type === "text" || b.type === "tool_use") as Anthropic.Beta.Messages.BetaContentBlockParam[] });
            const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
            for (const use of uses) {
              const t = run.tools.find((x) => x.def.name === use.name);
              const input = use.input && typeof use.input === "object" && !Array.isArray(use.input) ? (use.input as Record<string, unknown>) : null;
              try {
                if (!t) throw new Error(`Unknown tool ${use.name}.`);
                if (!input) throw new Error("Tool input must be a JSON object.");
                const r = await t.run(input);
                yield { type: "tool", name: t.label, detail: r.summary, agent: run.agent };
                results.push({ type: "tool_result", tool_use_id: use.id, content: r.text });
              } catch (e) {
                const msg = e instanceof Error ? e.message : "Tool failed.";
                yield { type: "tool", name: t?.label ?? use.name, detail: `couldn’t: ${msg}`, agent: run.agent };
                results.push({ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true });
              }
            }
            messages.push({ role: "user", content: results });
            continue;
          }
          if (final.stop_reason === "max_tokens") yield { type: "text", agent: run.agent, text: "\n\n_(Stopped at the length limit.)_" };
          usageSink({ at: new Date().toISOString(), model: step.model, key: k + 1, agent: run.agent, input, output, ms: Date.now() - started, outcome: "ok" });
          yield { type: "done", engine: "claude", model: final.model, agent: run.agent };
          return;
        }
      } catch (err) {
        if (run.signal?.aborted) return;
        const cool = cooldownFor(err);
        if (cool) cooling.set(coolId(run.keys[k], step.model), Date.now() + cool);
        // Once text has streamed we can't splice another model in cleanly: report it instead.
        if (emitted || !isRetryable(err)) {
          usageSink({ at: new Date().toISOString(), model: step.model, key: k + 1, agent: run.agent, input, output, ms: Date.now() - started, outcome: "error", reason: describeError(err) });
          yield { type: "error", agent: run.agent, message: describeError(err) };
          return;
        }
        usageSink({ at: new Date().toISOString(), model: step.model, key: k + 1, agent: run.agent, input, output, ms: Date.now() - started, outcome: "fallback", reason: describeError(err) });
        previous = label;
        reason = describeError(err);
      }
    }
  }
  yield { type: "error", agent: run.agent, message: `Every model in the chain is unavailable (last: ${previous ?? "none"} — ${reason}). Try again shortly or add another key.` };
}
