// Claude (cloud API) engine with a fallback chain.
//
// - Rate limits, overloads, server errors and network failures move to the next
//   key, then the next model — as long as nothing has streamed yet.
// - Policy refusals on Opus/Sonnet are handled server-side with `fallbacks: "default"`.
import Anthropic from "@anthropic-ai/sdk";
import type { GugEvent } from "../events.js";

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
}

export async function* runClaude(run: ClaudeRun): AsyncGenerator<GugEvent> {
  if (run.keys.length === 0) {
    yield { type: "error", agent: run.agent, message: "No Claude API key yet. Add one in Settings → API keys (or the Setup guide)." };
    return;
  }
  const chain = chainFor(run.mode);
  let previous: string | undefined;
  let reason = "";
  for (const step of chain) {
    for (let k = 0; k < run.keys.length; k++) {
      const client = new Anthropic({ apiKey: run.keys[k], maxRetries: 1 });
      const label = run.keys.length > 1 ? `${step.model} (key ${k + 1})` : step.model;
      if (previous) yield { type: "fallback", from: previous, to: label, reason };
      let emitted = false;
      try {
        const stream = client.beta.messages.stream(
          {
            model: step.model,
            max_tokens: run.maxTokens ?? (step === HAIKU ? 32000 : 64000),
            system: run.system,
            messages: run.messages,
            ...(step.effort ? { output_config: { effort: run.mode === "fast" ? "low" : run.mode === "deep" ? "high" : "medium" } } : {}),
            ...(step.fallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal: run.signal },
        );
        yield { type: "start", engine: "claude", model: step.model, agent: run.agent };
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            emitted = true;
            yield { type: "text", text: ev.delta.text, agent: run.agent };
          } else if (ev.type === "content_block_start" && ev.content_block.type === "fallback") {
            yield { type: "fallback", from: step.model, to: "safety fallback model", reason: "request declined by the first model" };
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          yield { type: "error", agent: run.agent, message: "Claude declined this request." };
          return;
        }
        if (final.stop_reason === "max_tokens") yield { type: "text", agent: run.agent, text: "\n\n_(Stopped at the length limit.)_" };
        yield { type: "done", engine: "claude", model: final.model, agent: run.agent };
        return;
      } catch (err) {
        if (run.signal?.aborted) return;
        // Once text has streamed we can't splice another model in cleanly: report it instead.
        if (emitted || !isRetryable(err)) {
          yield { type: "error", agent: run.agent, message: describeError(err) };
          return;
        }
        previous = label;
        reason = describeError(err);
      }
    }
  }
  yield { type: "error", agent: run.agent, message: `Every model in the chain is unavailable (last: ${previous ?? "none"} — ${reason}). Try again shortly or add another key.` };
}
