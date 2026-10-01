// What the last build changed, file by file, with one-click undo.
import { useState } from "react";
import { Icon, P } from "./ui";

export type DiffLine = [" " | "+" | "-", string];
export interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  added: number;
  removed: number;
  hunks: { at: number; lines: DiffLine[] }[] | null;
}
export interface ChangeSet {
  snapshot: { at: string; prompt: string } | null;
  files: FileChange[];
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};
const TAG = { added: ["NEW", "#F4F4F5"], modified: ["EDIT", "#FF5A66"], deleted: ["GONE", "#71717A"] } as const;

export function Changes({ data, busy, onUndo, onOpen }: { data: ChangeSet | null; busy: boolean; onUndo: () => void; onOpen: (path: string) => void }) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  if (!data?.snapshot)
    return (
      <div className="muted" style={{ padding: 24, fontSize: 13, lineHeight: 1.6 }}>
        After Forge builds something, every change shows up here — line by line — and you can undo the whole build in one click.
      </div>
    );
  const add = data.files.reduce((a, f) => a + f.added, 0);
  const rem = data.files.reduce((a, f) => a + f.removed, 0);
  return (
    <div className="tx-rise chg">
      <div className="chg-head">
        <div style={{ minWidth: 0, flexGrow: 1 }}>
          <div className="eyebrow" style={{ fontSize: 10 }}>Last build · {ago(data.snapshot.at)}</div>
          <div style={{ fontSize: 13.5, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={data.snapshot.prompt}>“{data.snapshot.prompt || "Build"}”</div>
          <div className="mono" style={{ fontSize: 11, marginTop: 4 }}>
            {data.files.length ? (
              <>
                <span style={{ color: "#F4F4F5" }}>+{add}</span> <span style={{ color: "#FF5A66" }}>−{rem}</span> <span className="muted">across {data.files.length} file{data.files.length === 1 ? "" : "s"}</span>
              </>
            ) : (
              <span className="muted">No file changes since this build started.</span>
            )}
          </div>
        </div>
        <button type="button" className="btn" disabled={busy || !data.files.length} onClick={onUndo} title="Put every file back the way it was before this build">
          <Icon d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3" size={14} /> Undo build
        </button>
      </div>
      {data.files.map((f) => {
        const open = !closed[f.path];
        return (
          <div key={f.path} className="chg-file">
            <button type="button" className="chg-fhead" aria-expanded={open} onClick={() => setClosed((c) => ({ ...c, [f.path]: open }))}>
              <Icon d={open ? "M6 9l6 6 6-6" : "M9 6l6 6-6 6"} size={12} />
              <span className="mono" style={{ fontSize: 9, letterSpacing: ".1em", color: TAG[f.status][1], width: 34 }}>{TAG[f.status][0]}</span>
              <span className="mono" style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>{f.path}</span>
              <span className="chg-bar" aria-hidden>
                {Array.from({ length: 5 }, (_, i) => {
                  const t = f.added + f.removed || 1;
                  const adds = Math.round((f.added / t) * 5);
                  return <i key={i} style={{ background: i < adds ? "#F4F4F5" : f.removed ? "#FF2B3A" : "#3F3F46" }} />;
                })}
              </span>
              <span className="mono" style={{ fontSize: 11 }}>
                <span style={{ color: "#F4F4F5" }}>+{f.added}</span> <span style={{ color: "#FF5A66" }}>−{f.removed}</span>
              </span>
            </button>
            {open && (
              <div className="chg-body mono">
                {!f.hunks ? (
                  <div className="muted" style={{ padding: "10px 14px", fontSize: 11.5 }}>Binary or very large file — not shown.</div>
                ) : (
                  f.hunks.map((h, i) => (
                    <div key={i}>
                      <div className="chg-at">@@ line {h.at}</div>
                      {h.lines.map(([k, t], j) => (
                        <div key={j} className={`chg-ln ${k === "+" ? "add" : k === "-" ? "del" : ""}`}>
                          <span className="chg-k">{k}</span>
                          <span>{t || " "}</span>
                        </div>
                      ))}
                    </div>
                  ))
                )}
                {f.status !== "deleted" && (
                  <button type="button" className="chip" style={{ margin: "8px 12px 10px" }} onClick={() => onOpen(f.path)}>
                    <Icon d={P.Code} size={11} /> Open file
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
