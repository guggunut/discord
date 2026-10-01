import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, stream, type GugEvent } from "../api";
import { useApp } from "../App";
import { Md } from "../Md";
import { play } from "../sfx";
import { Icon, P, Seg, Sigil } from "../ui";

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

interface Step {
  kind: "tool" | "text" | "error" | "info";
  text: string;
}

export function Code() {
  const { state, toast } = useApp();
  const [projects, setProjects] = useState<string[]>([]);
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
  const [bottom, setBottom] = useState<"preview" | "log">("preview");
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
    api<string[]>("/api/projects").then(setProjects).catch(() => {});
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

  const newProject = async () => {
    const name = newName.trim();
    if (!name) return;
    const r = await api<{ project: string }>("/api/projects", { body: { name } });
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
    setBottom("log");
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
      if (ev.type === "tool") setSteps((s) => [...s, { kind: "tool", text: `${ev.name} ${ev.detail}` }]);
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
      setBottom("preview");
    });
  };

  const lines = useMemo(() => content.split("\n"), [content]);
  const lang = file?.split(".").pop()?.toUpperCase() ?? "";
  const SUGGEST = ["Make a pomodoro timer with a red progress ring", "Build a landing page for my desk lamp store", "Turn this into a to-do app that saves to localStorage", "Add a dark/light toggle"];

  return (
    <div className="g3 cols" style={{ ["--cols" as string]: "250px minmax(0,1fr) 370px" }}>
      <section className="card rise d2" style={{ padding: "14px 10px", display: "flex", flexDirection: "column", gap: 4, alignSelf: "start" }}>
        <label className="label" style={{ padding: "0 8px 8px" }}>
          Project
          <select className="field" value={project} onChange={(e) => setProject(e.target.value)} style={{ height: 38 }}>
            {projects.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div style={{ display: "flex", gap: 6, padding: "0 8px 10px" }}>
          <label className="sr" htmlFor="newproj">
            New project name
          </label>
          <input id="newproj" className="field" style={{ height: 34, fontSize: 12, flexGrow: 1, minWidth: 0 }} placeholder="new-project" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && newProject()} />
          <button type="button" className="btn iconbtn" style={{ width: 34, height: 34 }} aria-label="Create project" onClick={newProject}>
            <Icon d={P.plus} size={14} />
          </button>
        </div>
        <div className="eyebrow" style={{ fontSize: 10, padding: "6px 8px" }}>
          Files
        </div>
        <div key={project} className="tx-wipe scroll" style={{ maxHeight: 420 }}>
          {files.map((f) => (
            <button key={f.path} type="button" data-sfx="tab" className="listbtn mono" onClick={() => open(f.path)} style={{ minHeight: 34, padding: "6px 8px", fontSize: 12, background: f.path === file ? "rgba(255,255,255,0.06)" : undefined, color: f.path === file ? "#fff" : "#A1A1AA" }}>
              <Icon d={P.file} size={13} />
              <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.path}</span>
            </button>
          ))}
          {!files.length && <div className="muted" style={{ fontSize: 12, padding: 8 }}>Empty. Describe something to build →</div>}
        </div>
        <div style={{ margin: "12px 8px 0", paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", fontSize: 11, color: "#71717A", lineHeight: 1.5, overflowWrap: "anywhere" }} className="mono">
          {state.dataDir}/workspaces/{project}
        </div>
      </section>

      <section style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <div className="card rise d3" style={{ padding: 0, overflow: "hidden", background: "#070708" }}>
          <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.07)", background: "#050505", minHeight: 44 }}>
            <span className="mono" style={{ padding: "0 16px", fontSize: 12, boxShadow: "inset 0 2px 0 #FF2B3A", height: 44, display: "flex", alignItems: "center", background: "#0A0A0B" }}>
              {file ?? "no file"}
              {dirty && <span style={{ color: "#FF2B3A", marginLeft: 6 }}>●</span>}
            </span>
            <span style={{ flexGrow: 1 }} />
            {file && (editing ? (
              <>
                <button type="button" className="chip" style={{ marginRight: 6 }} onClick={() => open(file)}>Cancel</button>
                <button type="button" className="btn btn-red" style={{ height: 32, marginRight: 8, padding: "0 12px", fontSize: 12 }} onClick={saveFile}>Save</button>
              </>
            ) : (
              <button type="button" className="chip" style={{ marginRight: 8 }} onClick={() => setEditing(true)}>
                <Icon d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" size={12} /> Edit
              </button>
            ))}
            <span className="mono hide-sm" style={{ padding: "0 14px", fontSize: 11, color: "#52525B" }}>{lang}</span>
          </div>
          <div style={{ minHeight: 380, maxHeight: 520, overflow: "auto" }}>
            {editing ? (
              <textarea aria-label={`Editing ${file}`} spellCheck={false} value={content} onChange={(e) => (setContent(e.target.value), setDirty(true))} onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "s") (e.preventDefault(), void saveFile());
              }} style={{ width: "100%", minHeight: 500, border: 0, outline: 0, resize: "vertical", background: "#070708", color: "#F4F4F5", padding: "14px 16px", fontFamily: "'Geist Mono', monospace", fontSize: 13, lineHeight: "22px" }} />
            ) : (
              <div key={file ?? "none"} className="tx-wipe" style={{ padding: "14px 0" }}>
                {file ? lines.map((ln, i) => (
                  <div key={i} className="ed-line">
                    <span>{i + 1}</span>
                    <span style={{ whiteSpace: "pre" }}>{highlight(ln)}</span>
                  </div>
                )) : <div className="muted" style={{ padding: 20 }}>Pick a file, or describe what to build.</div>}
              </div>
            )}
          </div>
        </div>
        <div className="card rise d4" style={{ padding: "14px 16px" }}>
          <div className="row" style={{ marginBottom: 12 }}>
            <Seg label="Bottom panel" value={bottom} onChange={setBottom} width={240} options={[["preview", "Preview"], ["log", "Build log"]]} />
            <span style={{ flexGrow: 1 }} />
            <button type="button" className="btn iconbtn" aria-label="Reload preview" onClick={() => setPreviewKey((k) => k + 1)}>
              <Icon d={P.refresh} size={15} />
            </button>
            <a className="btn iconbtn" href={`/preview/${state.previewKey}/${project}/`} target="_blank" rel="noopener" aria-label="Open preview in a new tab">
              <Icon d={P.arrow} size={15} />
            </a>
          </div>
          {bottom === "preview" ? (
            <div className="tx-zoom" style={{ height: 380 }}>
              {files.some((f) => f.path === "index.html") ? (
                <iframe key={previewKey} className="preview" title="Project preview" src={`/preview/${state.previewKey}/${project}/`} sandbox="allow-scripts allow-forms allow-modals" />
              ) : (
                <div className="muted" style={{ fontSize: 13 }}>No index.html yet — the preview shows web projects.</div>
              )}
            </div>
          ) : (
            <div className="tx-rise mono scroll" style={{ fontSize: 12, lineHeight: 1.8, maxHeight: 380, color: "#A1A1AA" }}>
              {!steps.length && <div>Nothing yet.</div>}
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

      <section className="card hot rise d4" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14, alignSelf: "start" }}>
        <div className="row">
          <Sigil id="forge" size={40} />
          <div style={{ flexGrow: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Vibe with Forge</div>
            <div className="muted" style={{ fontSize: 12 }}>Say what you want. Forge writes it.</div>
          </div>
        </div>
        <Seg label="Engine" value={engine} onChange={setEngine} options={[["code", "Claude Code"], ["api", "Claude API"]]} />
        <p className="muted" style={{ margin: "-4px 0 0", fontSize: 12, lineHeight: 1.5 }}>
          {engine === "code"
            ? state.engines.claudeCode.ok
              ? "Claude Code works in this project folder: reads, edits, and runs safe commands like npm test."
              : "Claude Code isn’t installed yet — see the Setup guide. Switch to Claude API to build right now."
            : "Claude API writes complete files into the project. Nothing outside the project folder is touched."}
        </p>
        <div style={{ position: "relative" }}>
          <label className="sr" htmlFor="vibe-in">
            Describe the change
          </label>
          <textarea id="vibe-in" className="field" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.preventDefault(), vibe());
          }} placeholder="e.g. Make a pomodoro timer with a red progress ring" style={{ width: "100%", paddingRight: 56, resize: "none" }} />
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
          <div className="eyebrow" style={{ fontSize: 10 }}>
            Try
          </div>
          {SUGGEST.map((s) => (
            <button key={s} type="button" className="chip" onClick={() => setPrompt(s)} style={{ height: "auto", minHeight: 34, padding: "6px 12px", justifyContent: "flex-start", textAlign: "left", borderRadius: 10 }}>
              {s}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
