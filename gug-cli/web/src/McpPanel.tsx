// Connect apps to Forge through MCP (Model Context Protocol): Blender, Roblox
// Studio, a folder, or any MCP server. Claude Code uses whichever are switched on.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { useApp } from "./App";
import { play } from "./sfx";
import { Brand, Icon, P, Switch } from "./ui";

export interface McpServer {
  id: string;
  name: string;
  app: "blender" | "roblox" | "filesystem" | "custom";
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
  tools?: string[];
  testedAt?: string;
}
interface Preset { name: string; label: string; command: string; args: string[]; blurb: string; steps: string[] }
const BRANDS: Record<McpServer["app"], string> = { blender: "blender", roblox: "roblox", filesystem: "folder", custom: "local" };

/** Splits "a b 'c d'" into ["a","b","c d"]. */
export const splitArgs = (s: string) => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^["']|["']$/g, ""));

export function McpPanel({ onClose, onChange }: { onClose: () => void; onChange: (servers: McpServer[]) => void }) {
  const { toast, state } = useApp();
  const [servers, setServers] = useState<McpServer[]>([]);
  const [presets, setPresets] = useState<Record<string, Preset>>({});
  const [draft, setDraft] = useState<{ id?: string; app: McpServer["app"]; name: string; command: string; args: string; env: string } | null>(null);
  const [busy, setBusy] = useState("");

  const load = async () => {
    const r = await api<{ servers: McpServer[]; presets: Record<string, Preset> }>("/api/mcp");
    setServers(r.servers);
    setPresets(r.presets);
    onChange(r.servers);
  };
  useEffect(() => void load(), []);

  const startFrom = (app: McpServer["app"]) => {
    const p = app === "custom" ? null : presets[app];
    setDraft({ app, name: p?.name ?? "", command: p?.command ?? "", args: (p?.args ?? []).map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "), env: "" });
  };
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    try {
      const env = Object.fromEntries(draft.env.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
      const body = { app: draft.app, name: draft.name, command: draft.command, args: splitArgs(draft.args), env };
      const s = await api<McpServer>(draft.id ? `/api/mcp/${draft.id}` : "/api/mcp", { method: draft.id ? "PUT" : "POST", body });
      setDraft(null);
      await load();
      void test(s);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };
  const test = async (s: McpServer) => {
    setBusy(s.id);
    try {
      const r = await api<{ tools: string[] }>(`/api/mcp/${s.id}/test`, { body: {} });
      play("success");
      toast(`${s.name} is working — ${r.tools.length} tools.`);
    } catch (e) {
      toast(`${s.name}: ${(e as Error).message}`, "err");
    } finally {
      setBusy("");
      void load();
    }
  };
  const toggle = async (s: McpServer, enabled: boolean) => {
    await api(`/api/mcp/${s.id}`, { method: "PUT", body: { enabled } });
    void load();
  };
  const remove = async (s: McpServer) => {
    if (!confirm(`Remove ${s.name}?`)) return;
    await api(`/api/mcp/${s.id}`, { method: "DELETE" });
    void load();
  };
  const preset = draft && draft.app !== "custom" ? presets[draft.app] : null;

  return createPortal(
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pal card pop" role="dialog" aria-label="Connect apps" style={{ width: "min(860px, 100%)", padding: 22, maxHeight: "84vh", overflowY: "auto" }}>
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="eyebrow" style={{ fontSize: 10, color: "#FF5A66", flexGrow: 1 }}>MCP · Model Context Protocol</span>
          <button type="button" className="chip" aria-label="Close" onClick={onClose}><Icon d={P.x} size={12} /></button>
        </div>
        <h2 className="disp" style={{ margin: "2px 0 6px", fontSize: 24, fontWeight: 300 }}>Connect apps to Forge<span style={{ color: "#FF2B3A" }}>.</span></h2>
        <p className="muted" style={{ margin: "0 0 16px", fontSize: 13, lineHeight: 1.55 }}>
          Switched-on connections are handed to Claude Code when you build with it, so Forge can model in Blender, edit your place in Roblox Studio, and more. {state.engines.claudeCode.ok ? "" : "Install Claude Code first — MCP runs through it."}
        </p>

        {servers.map((s) => (
          <div key={s.id} className="mcp-row">
            <Brand name={BRANDS[s.app]} size={40} variant={s.enabled ? "red" : ""} />
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <b style={{ fontSize: 14 }}>{s.name}</b>
                <span className="mono" style={{ fontSize: 9, letterSpacing: ".1em", color: s.tools ? "#F4F4F5" : "#71717A" }}>{s.tools ? `✓ ${s.tools.length} TOOLS` : "NOT TESTED"}</span>
              </div>
              <div className="mono muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{[s.command, ...s.args].join(" ")}</div>
              {s.tools && <div className="muted" style={{ fontSize: 11, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.tools.slice(0, 6).join(" · ")}{s.tools.length > 6 ? " …" : ""}</div>}
            </div>
            <button type="button" className="chip" disabled={!!busy} onClick={() => void test(s)}>{busy === s.id ? "Testing…" : "Test"}</button>
            <button type="button" className="chip" onClick={() => setDraft({ id: s.id, app: s.app, name: s.name, command: s.command, args: s.args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" "), env: s.envKeys.map((k) => `${k}=`).join("\n") })}>Edit</button>
            <Switch on={s.enabled} label={`Use ${s.name}`} onChange={(v) => void toggle(s, v)} />
            <button type="button" className="chip" aria-label={`Remove ${s.name}`} style={{ padding: "0 7px" }} onClick={() => void remove(s)}><Icon d={P.x} size={11} /></button>
          </div>
        ))}

        {!draft ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 10, marginTop: servers.length ? 14 : 0 }}>
            {(["blender", "roblox", "filesystem", "custom"] as const).map((app) => (
              <button key={app} type="button" className="mcp-card" onClick={() => startFrom(app)}>
                <Brand name={BRANDS[app]} size={42} variant={app === "blender" || app === "roblox" ? "red" : "tint"} />
                <b style={{ fontSize: 14, marginTop: 10 }}>{app === "custom" ? "Any MCP server" : presets[app]?.label}</b>
                <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.45 }}>{app === "custom" ? "Unity, Figma, a database… paste its command." : presets[app]?.blurb}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="tx-drop" style={{ marginTop: 14, padding: 16, borderRadius: 16, border: "1px solid rgba(255,43,58,0.4)", background: "rgba(255,43,58,0.04)", display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="row">
              <Brand name={BRANDS[draft.app]} size={34} variant="red" />
              <b style={{ fontSize: 15, flexGrow: 1 }}>{draft.id ? `Edit ${draft.name}` : preset ? `Connect ${preset.label}` : "Connect an MCP server"}</b>
            </div>
            {preset && (
              <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>
                {preset.steps.map((s) => <li key={s}>{s}</li>)}
              </ol>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "160px minmax(0,1fr)", gap: 8, alignItems: "center" }}>
              <label className="eyebrow" style={{ fontSize: 10 }} htmlFor="mcp-name">Name</label>
              <input id="mcp-name" className="field mono" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="blender" style={{ height: 38, fontSize: 12 }} />
              <label className="eyebrow" style={{ fontSize: 10 }} htmlFor="mcp-cmd">Command</label>
              <input id="mcp-cmd" className="field mono" value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder={draft.app === "roblox" ? "C:\\path\\to\\rbx-studio-mcp.exe" : "uvx, npx, or a full path"} style={{ height: 38, fontSize: 12 }} />
              <label className="eyebrow" style={{ fontSize: 10 }} htmlFor="mcp-args">Arguments</label>
              <input id="mcp-args" className="field mono" value={draft.args} onChange={(e) => setDraft({ ...draft, args: e.target.value })} placeholder="--stdio" style={{ height: 38, fontSize: 12 }} />
              <label className="eyebrow" style={{ fontSize: 10 }} htmlFor="mcp-env">Secrets <span className="muted">(optional)</span></label>
              <textarea id="mcp-env" className="field mono" rows={2} value={draft.env} onChange={(e) => setDraft({ ...draft, env: e.target.value })} placeholder="API_KEY=… (one per line, stored encrypted)" style={{ fontSize: 12 }} />
            </div>
            <div className="row" style={{ gap: 8 }}>
              <span className="muted" style={{ fontSize: 11, flexGrow: 1 }}>Saving runs a quick test: GUG-cli starts the server, says hello and lists its tools.</span>
              <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
              <button type="button" className="btn btn-red" disabled={busy === "save" || !draft.name || !draft.command} onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save & test"}</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
