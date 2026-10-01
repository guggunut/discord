import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { Md } from "../Md";
import { play } from "../sfx";
import { Changes, type ChangeSet } from "../Changes";
import { LiveView, type Activity } from "../LiveView";
import { McpPanel, type McpServer } from "../McpPanel";
import { Brand, Icon, P, Seg, Sigil } from "../ui";

const KW = new Set("import from export async function const let var return for await of try catch if else throw new class extends yield type interface default while true false null undefined def elif print in not and or is lambda with as pass".split(" "));

function highlight(line: string): ReactNode[] {
  if (/^\s*(\/\/|#)/.test(line)) return [<span key="c" className="tok-c">{line}</span>];
  const out: ReactNode[] = [];
  const re = /("[^"]*"|'[^']*'|`[^`]*`|\/\/.*$|\b[A-Za-z_][A-Za-z0-9_]*\b|\b\d+(?:\.\d+)?\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const t = m[0];
    const cls = /^["'`]/.test(t) ? "tok-s" : t.startsWith("//") ? "tok-c" : KW.has(t) ? "tok-k" : /^\d/.test(t) ? "tok-n" : line[m.index + t.length] === "(" ? "tok-f" : /^[A-Z]/.test(t) ? "tok-t" : "";
    out.push(cls ? <span key={k++} className={cls}>{t}</span> : t);
    last = m.index + t.length;
  }
  out.push(line.slice(last));
  return out;
}

/** "mcp__blender__execute_blender_code" → "Blender · execute blender code" */
export function toolName(n: string) {
  const m = /^mcp__([^_]+(?:-[^_]+)*)__(.+)$/.exec(n);
  if (!m) return n;
  const app = m[1].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return `${app} · ${m[2].replace(/_/g, " ")}`;
}
const EXT_TONE: Record<string, string> = { html: "#FF2B3A", htm: "#FF2B3A", css: "#F4F4F5", js: "#FF8A93", mjs: "#FF8A93", ts: "#FF8A93", json: "#A1A1AA", luau: "#FF5A66", lua: "#FF5A66", md: "#A1A1AA", svg: "#F4F4F5", py: "#FF8A93" };

interface Step {
  kind: "tool" | "text" | "error" | "info";
  text: string;
}

export function Code() {
  const { state, toast } = useApp();
  const [projects, setProjects] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [templates, setTemplates] = useState<{ id: string; name: string; blurb: string }[]>([]);
  const [tpl, setTpl] = useState("blank");
  const [deployed, setDeployed] = useState<{ url: string; at: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [project, setProject] = useState(() => localStorage.getItem("gug-project") ?? "playground");
  const [files, setFiles] = useState<{ path: string; size: number }[]>([]);
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [engine, setEngine] = useState<"api" | "code">(state.engines.claudeCode.ok ? "code" : "api");
  const [prompt, setPrompt] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"preview" | "code" | "live" | "changes" | "log">(() => (localStorage.getItem("gug-code-tab") as "code") || "preview");
  const [chg, setChg] = useState<ChangeSet | null>(null);
  const loadChanges = useCallback(() => api<ChangeSet>(`/api/projects/${project}/changes`).then(setChg).catch(() => setChg(null)), [project]);
  const [device, setDevice] = useState<"desktop" | "tablet" | "phone">("desktop");
  const [mcpOpen, setMcpOpen] = useState(false);
  const [mcp, setMcp] = useState<McpServer[]>([]);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [previewKey, setPreviewKey] = useState(0);
  const [newName, setNewName] = useState("");
  const abortRef = useRef<() => void>(() => {});

  const loadFiles = useCallback(async () => {
    try {
      const f = await api<{ path: string; size: number }[]>(`/api/projects/${project}/files`);
      setFiles(f);
      return f;
    } catch {
      setFiles([]);
      return [];
    }
  }, [project]);

  useEffect(() => {
    try {
      localStorage.setItem("gug-code-tab", tab);
    } catch {
      /* private mode */
    }
  }, [tab]);
  useEffect(() => {
    api<{ servers: McpServer[] }>("/api/mcp").then((r) => setMcp(r.servers)).catch(() => {});
    api<string[]>("/api/projects").then(setProjects).catch(() => {});
    api<{ id: string; name: string; blurb: string }[]>("/api/templates").then(setTemplates).catch(() => {});
    return () => abortRef.current();
  }, []);
  useEffect(() => {
    localStorage.setItem("gug-project", project);
    setFile(null);
    setSteps([]);
    void loadFiles().then((f) => {
      const first = f.find((x) => x.path === "index.html") ?? f[0];
      if (first) void open(first.path);
    });
    setPreviewKey((k) => k + 1);
    void loadChanges();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);

  const open = async (path: string) => {
    if (dirty && !confirm("Discard unsaved changes?")) return;
    try {
      const r = await api<{ content: string }>(`/api/projects/${project}/file?path=${encodeURIComponent(path)}`);
      setFile(path);
      setContent(r.content);
      setEditing(false);
      setDirty(false);
    } catch (e) {
      toast((e as Error).message, "err");
    }
  };

  const saveFile = async () => {
    if (!file) return;
    await api(`/api/projects/${project}/file`, { method: "PUT", body: { path: file, content } });
    setDirty(false);
    setEditing(false);
    setPreviewKey((k) => k + 1);
    toast(`Saved ${file}`);
  };

  useEffect(() => {
    setDeployed(null);
    api<{ url: string; at: string } | null>(`/api/projects/${project}/deploy`).then(setDeployed).catch(() => {});
  }, [project]);
  const publish = async () => {
    if (!confirm(`Publish “${project}” to the public web with Vercel? Anyone with the link can see it.`)) return;
    setPublishing(true);
    try {
      const r = await api<{ url: string }>(`/api/projects/${project}/deploy`, { body: {} });
      setDeployed({ url: r.url, at: new Date().toISOString() });
      toast(`Live at ${r.url} (it can take a few seconds to appear).`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setPublishing(false);
    }
  };

  const newProject = async () => {
    const name = newName.trim();
    if (!name) return;
    const r = await api<{ project: string }>("/api/projects", { body: { name, template: tpl } });
    setPicking(false);
    setProjects(await api<string[]>("/api/projects"));
    setProject(r.project);
    setNewName("");
    toast(`Created ${r.project}`);
  };

  const vibe = (text = prompt) => {
    const t = text.trim();
    if (!t || busy) return;
    play("send");
    setBusy(true);
    // With an app connected, watch it live; otherwise follow the build log.
    const usingApps = engine === "code" && mcp.some((m) => m.enabled);
    setTab(usingApps ? "live" : "log");
    setActivity([]);
    setSteps([{ kind: "info", text: `${engine === "code" ? "Claude Code" : "Claude API"} · ${t}` }]);
    let reply = "";
    const onEvent = (ev: GugEvent) => {
      if (ev.type === "text") {
        reply += ev.text;
        // Hide raw <file> blocks from the log while they stream in.
        const visible = reply.replace(/<file path="[^"]*">[\s\S]*?(<\/file>|$)/g, "").trim();
        setSteps((s) => {
          const out = s.filter((x) => x.kind !== "text");
          return visible ? [...out, { kind: "text", text: visible }] : out;
        });
      }
      if (ev.type === "tool") {
        setSteps((s) => [...s, { kind: "tool", text: `${toolName(ev.name)} ${ev.detail}` }]);
        setActivity((a) => [...a, { text: `${toolName(ev.name)}${ev.detail ? ` · ${ev.detail}` : ""}`, at: Date.now() }].slice(-40));
      }
      if (ev.type === "fallback") setSteps((s) => [...s, { kind: "info", text: `Router: ${ev.from} → ${ev.to ?? "next"}` }]);
      if (ev.type === "error") setSteps((s) => [...s, { kind: "error", text: ev.message }]);
      if (ev.type === "start" && ev.model) setSteps((s) => [...s, { kind: "info", text: `Model · ${ev.model}` }]);
    };
    abortRef.current = stream(`/api/projects/${project}/vibe`, { prompt: t, engine }, onEvent, async () => {
      setBusy(false);
      setPrompt("");
      const f = await loadFiles();
      setPreviewKey((k) => k + 1);
      if (file && f.some((x) => x.path === file)) void open(file);
      else if (f[0]) void open((f.find((x) => x.path === "index.html") ?? f[0]).path);
      play("success");
      void loadChanges();
      setTab((t) => (t === "log" ? "preview" : t));
    });
  };

  const lines = useMemo(() => content.split("\n"), [content]);
  const lang = file?.split(".").pop()?.toUpperCase() ?? "";
  const SUGGEST = ["Make a pomodoro timer with a red progress ring", "Build a landing page for my desk lamp store", "Turn this into a to-do app that saves to localStorage", "Add a dark/light toggle"];
  const APP_SUGGEST: Record<string, string[]> = {
    blender: ["Model a low-poly desk lamp with a red glowing bar and render it", "Set up a moody 3-point lighting rig for a product shot"],
    roblox: ["Build a 10-stage obby with checkpoints and a red/black theme", "Add a leaderboard and a VIP door to my place"],
  };
  const on = mcp.filter((m) => m.enabled);
  const suggest = [...new Set([...on.flatMap((m) => APP_SUGGEST[m.app] ?? []), ...SUGGEST])].slice(0, 5);
  const hasIndex = files.some((f) => f.path === "index.html");
  const DEVICE_W = { desktop: "100%", tablet: "820px", phone: "390px" } as const;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* project bar */}
      <div className="card rise d1 code-bar">
        <div className="row" style={{ gap: 12, flexGrow: 1, minWidth: 260 }}>
          <span className="code-proj-ic"><Icon d={P.folder} size={18} /></span>
          <div style={{ minWidth: 0 }}>
            <label className="sr" htmlFor="proj-select">Project</label>
            <select id="proj-select" className="code-proj" value={project} onChange={(e) => setProject(e.target.value)}>
              {projects.map((p) => <option key={p}>{p}</option>)}
            </select>
            <div className="mono muted" style={{ fontSize: 10, letterSpacing: ".06em" }}>
              {files.length} FILES · {engine === "code" ? "CLAUDE CODE" : "CLAUDE API"}
              {deployed && (
                <a href={deployed.url} target="_blank" rel="noopener noreferrer" style={{ color: "#FF5A66", marginLeft: 8 }}>● {deployed.url.replace("https://", "")}</a>
              )}
            </div>
          </div>
        </div>
        <button type="button" className="code-apps" onClick={() => setMcpOpen(true)} title="Connect apps through MCP">
          {on.length ? on.map((m) => <Brand key={m.id} name={m.app === "custom" ? "local" : m.app === "filesystem" ? "folder" : m.app} size={26} variant="red" />) : <Icon d={P.plus} size={14} />}
          <span>{on.length ? `${on.length} app${on.length > 1 ? "s" : ""} connected` : "Connect apps"}</span>
        </button>
        <button type="button" className="btn" onClick={() => setPicking(!picking)}><Icon d={P.plus} size={14} /> New</button>
        <button type="button" className="btn" disabled={publishing} onClick={() => void publish()} title="Publish to the web with Vercel">
          <Icon d="M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3" size={14} color={deployed ? "#FF2B3A" : undefined} /> {publishing ? "Publishing…" : "Publish"}
        </button>
        <a className="btn iconbtn" href={`/api/projects/${project}/zip`} download aria-label={`Download ${project} as a zip`} title="Download as .zip" style={{ width: 44 }}>
          <Icon d={P.down} size={15} />
        </a>
      </div>

      {picking && (
        <div className="card tx-drop" style={{ padding: 16, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "stretch", borderColor: "rgba(255,43,58,0.4)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "0 1 220px" }}>
            <span className="eyebrow" style={{ fontSize: 10 }}>New project</span>
            <label className="sr" htmlFor="newproj">New project name</label>
            <input id="newproj" autoFocus className="field" style={{ height: 40, fontSize: 13 }} placeholder="project-name" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newProject()} />
            <div className="row" style={{ gap: 6 }}>
              <button type="button" className="btn" style={{ height: 36, flexGrow: 1 }} onClick={() => setPicking(false)}>Cancel</button>
              <button type="button" className="btn btn-red" style={{ height: 36, flexGrow: 1 }} disabled={!newName.trim()} onClick={newProject}>Create</button>
            </div>
          </div>
          {templates.map((t) => (
            <button key={t.id} type="button" className={`tpl-card ${tpl === t.id ? "on" : ""}`} onClick={() => setTpl(t.id)}>
              <b style={{ fontSize: 13 }}>{t.name}</b>
              <span className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>{t.blurb}</span>
            </button>
          ))}
        </div>
      )}

      <div className="g3 cols" style={{ ["--cols" as string]: "230px minmax(0,1fr) 360px" }}>
        {/* explorer */}
        <section className="card rise d2 code-explorer" style={{ padding: "14px 10px", display: "flex", flexDirection: "column", gap: 2, alignSelf: "start" }}>
          <div className="eyebrow" style={{ fontSize: 10, padding: "0 8px 8px" }}>Explorer</div>
          <div key={project} className="tx-wipe scroll" style={{ maxHeight: 520 }}>
            {files.map((f) => {
              const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
              const depth = f.path.split("/").length - 1;
              return (
                <button key={f.path} type="button" data-sfx="tab" className={`file-btn ${f.path === file ? "on" : ""}`} onClick={() => open(f.path)} style={{ paddingLeft: 10 + depth * 12 }} title={f.path}>
                  <span className="file-dot" style={{ background: EXT_TONE[ext] ?? "#52525B" }} />
                  <span className="mono" style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path.split("/").pop()}</span>
                  <span className="mono" style={{ fontSize: 9, color: "#52525B" }}>{ext.toUpperCase()}</span>
                </button>
              );
            })}
            {!files.length && <div className="muted" style={{ fontSize: 12, padding: 8 }}>Empty. Describe something to build →</div>}
          </div>
          <div className="mono hide-sm" style={{ margin: "12px 8px 0", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 10, color: "#52525B", lineHeight: 1.5, overflowWrap: "anywhere" }}>
            {state.dataDir}/workspaces/{project}
          </div>
        </section>

        {/* workspace */}
        <section className="card rise d3" style={{ padding: 0, overflow: "hidden", minWidth: 0, background: "#070708" }}>
          <div className="ws-tabs">
            {([["preview", "Preview", P.play], ["code", file ?? "Code", P.Code], ["live", "Live view", "M3 5h18v12H3zM8 21h8M12 17v4"], ["changes", "Changes", "M6 3v12M18 9v12M6 15a3 3 0 100 6 3 3 0 000-6zM18 3a3 3 0 100 6 3 3 0 000-6zM6 15c0-4 12-2 12-6"], ["log", "Build log", P.terminal]] as const).map(([k, label, ic]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                <Icon d={ic} size={13} /> <span className={k === "code" ? "mono" : ""}>{label}</span>
                {k === "code" && dirty && <span style={{ color: "#FF2B3A" }}>●</span>}
                {k === "live" && busy && on.length > 0 && <span className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "#FF2B3A" }} />}
                {k === "changes" && !!chg?.files.length && <span className="ws-count">{chg.files.length}</span>}
                {k === "log" && busy && <span className="dots3" style={{ transform: "scale(.7)" }}><span /><span /><span /></span>}
              </button>
            ))}
            <span style={{ flexGrow: 1 }} />
            {tab === "preview" && (
              <>
                <div className="ws-devices" role="radiogroup" aria-label="Device">
                  {(([["desktop", "Desktop", "M3 5h18v11H3zM8 20h8M12 16v4"], ["tablet", "Tablet", "M6 3h12v18H6zM11 18h2"], ["phone", "Phone", "M8 3h8v18H8zM11 18h2"]]) as const).map(([k, label, d]) => (
                    <button key={k} type="button" role="radio" aria-checked={device === k} aria-label={label} title={label} className={device === k ? "on" : ""} onClick={() => setDevice(k)}><Icon d={d} size={14} /></button>
                  ))}
                </div>
                <button type="button" className="btn iconbtn" aria-label="Reload preview" onClick={() => setPreviewKey((k) => k + 1)} style={{ width: 36, height: 36 }}><Icon d={P.refresh} size={14} /></button>
                <a className="btn iconbtn" href={`/preview/${state.previewKey}/${project}/`} target="_blank" rel="noopener" aria-label="Open preview in a new tab" style={{ width: 36, height: 36 }}><Icon d={P.arrow} size={14} /></a>
              </>
            )}
            {tab === "code" && file && (editing ? (
              <>
                <button type="button" className="chip" onClick={() => open(file)}>Cancel</button>
                <button type="button" className="btn btn-red" style={{ height: 32, padding: "0 12px", fontSize: 12 }} onClick={saveFile}>Save</button>
              </>
            ) : (
              <button type="button" className="chip" onClick={() => setEditing(true)}><Icon d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" size={12} /> Edit</button>
            ))}
            {tab === "code" && <span className="mono hide-sm" style={{ fontSize: 11, color: "#52525B" }}>{lang}</span>}
          </div>
          <div className="ws-body">
            {tab === "preview" && (
              <div key={device} className="tx-zoom ws-preview">
                {hasIndex ? (
                  <div className={`device ${device}`} style={{ width: DEVICE_W[device] }}>
                    <iframe key={previewKey} className="preview" title="Project preview" src={`/preview/${state.previewKey}/${project}/`} sandbox="allow-scripts allow-forms allow-modals" />
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: 13, padding: 24 }}>No index.html in this project — open the Code tab, or use Live view for apps like Blender and Roblox Studio.</div>
                )}
              </div>
            )}
            {tab === "code" &&
              (editing ? (
                <textarea aria-label={`Editing ${file}`} spellCheck={false} value={content} onChange={(e) => (setContent(e.target.value), setDirty(true))} onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "s") (e.preventDefault(), void saveFile());
                }} style={{ width: "100%", height: "100%", minHeight: 520, border: 0, outline: 0, resize: "none", background: "#070708", color: "#F4F4F5", padding: "14px 16px", fontFamily: "'Geist Mono', monospace", fontSize: 13, lineHeight: "22px" }} />
              ) : (
                <div key={file ?? "none"} className="tx-wipe" style={{ padding: "14px 0" }}>
                  {file ? lines.map((ln, i) => (
                    <div key={i} className="ed-line">
                      <span>{i + 1}</span>
                      <span style={{ whiteSpace: "pre" }}>{highlight(ln)}</span>
                    </div>
                  )) : <div className="muted" style={{ padding: 20 }}>Pick a file in the Explorer.</div>}
                </div>
              ))}
            {tab === "live" && (
              <LiveView activity={activity} busy={busy} hasBlender={on.some((m) => m.app === "blender")} />
            )}
            {tab === "changes" && (
              <Changes
                data={chg}
                busy={busy}
                onOpen={(p) => (void open(p), setTab("code"))}
                onUndo={async () => {
                  if (!confirm("Undo the last build? Every file goes back to how it was before it.")) return;
                  try {
                    const r = await api<{ restored: number }>(`/api/projects/${project}/undo`, { body: {} });
                    play("success");
                    toast(`Build undone — ${r.restored} file${r.restored === 1 ? "" : "s"} restored.`);
                    const f = await loadFiles();
                    setPreviewKey((k) => k + 1);
                    if (file && f.some((x) => x.path === file)) void open(file);
                    else if (f[0]) void open(f[0].path);
                    void loadChanges();
                  } catch (e) {
                    toast((e as Error).message, "err");
                  }
                }}
              />
            )}
            {tab === "log" && (
              <div className="tx-rise mono" style={{ fontSize: 12, lineHeight: 1.8, padding: "14px 18px", color: "#A1A1AA" }}>
                {!steps.length && <div>Nothing yet — builds show every step here.</div>}
                {steps.map((s, i) =>
                  s.kind === "text" ? (
                    <div key={i} className="md" style={{ fontFamily: "Geist, sans-serif", fontSize: 13, color: "#D4D4D8", margin: "8px 0" }}>
                      <Md text={s.text} />
                    </div>
                  ) : (
                    <div key={i} style={{ color: s.kind === "error" ? "#FF5A66" : s.kind === "tool" ? "#F4F4F5" : undefined }}>
                      <span style={{ color: "#FF2B3A" }}>{s.kind === "tool" ? "▸" : s.kind === "error" ? "✖" : "❯"}</span> {s.text}
                    </div>
                  ),
                )}
                {busy && <div><span className="dots3"><span /><span /><span /></span></div>}
              </div>
            )}
          </div>
        </section>

        {/* forge */}
        <section style={{ display: "flex", flexDirection: "column", gap: 18, alignSelf: "start" }}>
          <div className="card hot rise d4" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="row">
              <Sigil id="forge" size={40} />
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Vibe with Forge</div>
                <div className="muted" style={{ fontSize: 12 }}>Say what you want. Forge builds it.</div>
              </div>
            </div>
            <Seg label="Engine" value={engine} onChange={setEngine} options={[["code", "Claude Code"], ["api", "Claude API"]]} />
            <p className="muted" style={{ margin: "-4px 0 0", fontSize: 12, lineHeight: 1.5 }}>
              {engine === "code"
                ? state.engines.claudeCode.ok
                  ? on.length
                    ? `Claude Code works in this folder and can use ${on.map((m) => m.name).join(", ")}.`
                    : "Claude Code works in this folder: reads, edits and runs safe commands. Connect apps to build in Blender or Roblox Studio."
                  : "Claude Code isn’t installed yet — see the Setup guide. Switch to Claude API to build right now."
                : "Claude API writes complete files into the project. Nothing outside the folder is touched."}
            </p>
            <div style={{ position: "relative" }}>
              <label className="sr" htmlFor="vibe-in">Describe the change</label>
              <textarea id="vibe-in" className="field" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), vibe());
              }} placeholder={on.some((m) => m.app === "blender") ? "e.g. Model a low-poly desk lamp in Blender" : "e.g. Make a pomodoro timer with a red progress ring"} style={{ width: "100%", paddingRight: 56, resize: "none" }} />
              {busy ? (
                <button type="button" className="btn" aria-label="Stop" style={{ position: "absolute", right: 8, bottom: 12, width: 40, height: 40, padding: 0 }} onClick={() => (abortRef.current(), setBusy(false))}>
                  <Icon d="M7 7h10v10H7z" size={14} />
                </button>
              ) : (
                <button type="button" className="btn btn-red" data-sfx="none" aria-label="Build it" style={{ position: "absolute", right: 8, bottom: 12, width: 40, height: 40, padding: 0 }} onClick={() => vibe()}>
                  <Icon d={P.wand} size={18} />
                </button>
              )}
            </div>
            <div className="muted mono" style={{ fontSize: 10, marginTop: -8 }}>⌘/Ctrl + Enter to build</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div className="eyebrow" style={{ fontSize: 10 }}>Try</div>
              {suggest.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => setPrompt(s)} style={{ height: "auto", minHeight: 34, padding: "6px 12px", justifyContent: "flex-start", textAlign: "left", borderRadius: 10 }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
      {mcpOpen && <McpPanel onClose={() => setMcpOpen(false)} onChange={setMcp} />}
    </div>
  );
}
