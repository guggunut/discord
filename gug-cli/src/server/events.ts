// Everything an engine streams back to the UI or the CLI.
export type GugEvent =
  | { type: "start"; engine: string; model?: string; agent?: string }
  | { type: "text"; text: string; agent?: string }
  | { type: "tool"; name: string; detail: string; agent?: string }
  | { type: "fallback"; from: string; to?: string; reason: string }
  | { type: "files"; paths: string[] }
  | { type: "done"; engine: string; model?: string; agent?: string; costUsd?: number }
  | { type: "error"; message: string; agent?: string };
