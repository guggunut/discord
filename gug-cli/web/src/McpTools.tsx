// Try an MCP server's tools by hand: pick one, fill its arguments, run it, see what comes back.
import { useEffect, useState } from "react";
import { api } from "./api";
import { play } from "./sfx";
import { Icon } from "./ui";

interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { type?: string; default?: unknown; description?: string }>; required?: string[] };
}
type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string } | { type: "other"; text: string };

/** A starting point for a tool's arguments, built from its JSON schema. */
export function exampleArgs(schema: ToolInfo["inputSchema"]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema?.properties ?? {})) {
    if (p.default !== undefined) out[k] = p.default;
    else if (!(schema?.required ?? []).includes(k)) continue;
    else out[k] = p.type === "number" || p.type === "integer" ? 0 : p.type === "boolean" ? false : p.type === "array" ? [] : p.type === "object" ? {} : "";
  }
  return out;
}

export function McpTools({ serverId, serverName }: { serverId: string; serverName: string }) {
  const [tools, setTools] = useState<ToolInfo[] | null>(null);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<ToolInfo | null>(null);
  const [args, setArgs] = useState("{}");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ isError: boolean; content: Content[]; ms: number } | null>(null);

  useEffect(() => {
    api<ToolInfo[]>(`/api/mcp/${serverId}/tools`).then(setTools).catch((e) => setErr((e as Error).message));
  }, [serverId]);

  const choose = (t: ToolInfo) => {
    setPick(t);
    setResult(null);
    setArgs(JSON.stringify(exampleArgs(t.inputSchema), null, 2));
  };
  const run = async () => {
    if (!pick) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(args || "{}");
    } catch {
      setResult({ isError: true, content: [{ type: "text", text: "Arguments must be valid JSON, like {\"name\": \"Cube\"}." }], ms: 0 });
      return;
    }
    setRunning(true);
    const t0 = performance.now();
    try {
      const r = await api<{ isError: boolean; content: Content[] }>(`/api/mcp/${serverId}/call`, { body: { tool: pick.name, args: parsed } });
      setResult({ ...r, ms: Math.round(performance.now() - t0) });
      play(r.isError ? "error" : "success");
    } catch (e) {
      setResult({ isError: true, content: [{ type: "text", text: (e as Error).message }], ms: Math.round(performance.now() - t0) });
    } finally {
      setRunning(false);
    }
  };

  if (err) return <div className="mcp-tools muted" style={{ fontSize: 12 }}>Couldn’t reach {serverName}: {err}</div>;
  if (!tools) return <div className="mcp-tools muted mono" style={{ fontSize: 11 }}>Starting {serverName} and asking for its tools… <span className="dots3"><span /><span /><span /></span></div>;
  const props = Object.entries(pick?.inputSchema?.properties ?? {});
  return (
    <div className="mcp-tools">
      <div className="mcp-tool-list scroll" role="listbox" aria-label={`${serverName} tools`}>
        {tools.map((t) => (
          <button key={t.name} type="button" role="option" aria-selected={pick?.name === t.name} className={pick?.name === t.name ? "on" : ""} onClick={() => choose(t)} title={t.description}>
            {t.name}
          </button>
        ))}
        {!tools.length && <span className="muted" style={{ fontSize: 12 }}>This server has no tools.</span>}
      </div>
      {pick && (
        <div className="mcp-tool-run tx-rise">
          <div className="mono" style={{ fontSize: 12, color: "#fff" }}>{pick.name}</div>
          {pick.description && <p className="muted" style={{ margin: "4px 0 8px", fontSize: 12, lineHeight: 1.5, whiteSpace: "pre-line" }}>{pick.description.split("\n").slice(0, 6).join("\n")}</p>}
          {props.length > 0 && (
            <div className="mono" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6, fontSize: 10 }}>
              {props.map(([k, p]) => (
                <span key={k} className="mcp-arg" title={p.description}>
                  {k}
                  <i>{p.type ?? "any"}{(pick.inputSchema?.required ?? []).includes(k) ? " · required" : ""}</i>
                </span>
              ))}
            </div>
          )}
          <label className="sr" htmlFor={`args-${serverId}`}>Arguments (JSON)</label>
          <textarea id={`args-${serverId}`} className="field mono" rows={Math.min(8, Math.max(2, args.split("\n").length))} value={args} spellCheck={false} onChange={(e) => setArgs(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void run()} style={{ fontSize: 12, width: "100%", resize: "vertical" }} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 11, flexGrow: 1 }}>Runs for real in {serverName} — the same as when Forge uses it.</span>
            <button type="button" className="btn btn-red" style={{ height: 34, fontSize: 12 }} disabled={running} onClick={() => void run()}>
              <Icon d="M7 5l12 7-12 7z" size={12} /> {running ? "Running…" : "Run tool"}
            </button>
          </div>
          {result && (
            <div className={`mcp-result ${result.isError ? "err" : ""}`}>
              <div className="mono" style={{ fontSize: 9.5, letterSpacing: ".12em", color: result.isError ? "#FF5A66" : "#A1A1AA", marginBottom: 6 }}>
                {result.isError ? "ERROR" : "RESULT"}{result.ms ? ` · ${result.ms} MS` : ""}
              </div>
              {result.content.map((c, i) =>
                c.type === "image" ? (
                  <img key={i} src={`data:${c.mimeType};base64,${c.data}`} alt={`${pick.name} result`} />
                ) : (
                  <pre key={i}>{prettify(c.text)}</pre>
                ),
              )}
              {!result.content.length && <span className="muted" style={{ fontSize: 12 }}>Done — nothing returned.</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const prettify = (t: string) => {
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return t;
  }
};
