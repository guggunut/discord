// Keyboard shortcuts: "g" then a letter jumps to a screen, "?" shows the list.
import { useEffect, useRef, useState } from "react";
import { play } from "./sfx";
import type { Route } from "./ui";

export const JUMPS: [string, Route, string][] = [
  ["c", "command", "Command center"],
  ["a", "agents", "Agent room"],
  ["d", "code", "Code"],
  ["p", "apps", "Apps"],
  ["v", "ventures", "Ventures"],
  ["m", "markets", "Markets"],
  ["s", "studio", "Studio"],
  ["g", "growth", "Growth"],
  ["f", "flows", "Flows"],
  ["l", "academy", "Academy"],
  ["h", "guide", "Setup guide"],
  [",", "settings", "Settings"],
];

export function Shortcuts({ go }: { go: (r: Route) => void }) {
  const [open, setOpen] = useState(false);
  const goRef = useRef(go);
  goRef.current = go;
  useEffect(() => {
    let leader = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.matches?.("input, textarea, select") || el.isContentEditable)) return;
      if (document.querySelector('[aria-label="Command palette"]')) return; // the palette owns the keyboard while open
      if (e.key === "?") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") return setOpen(false);
      if (Date.now() - leader < 1200) {
        leader = 0;
        const hit = JUMPS.find(([k]) => k === e.key.toLowerCase());
        if (hit) {
          e.preventDefault();
          setOpen(false);
          play("nav");
          goRef.current(hit[1]);
        }
        return;
      }
      if (e.key === "g") leader = Date.now();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (!open) return null;
  const row = (keys: string[], label: string) => (
    <div key={label} className="row" style={{ padding: "6px 0", fontSize: 13, gap: 10 }}>
      <span style={{ flexGrow: 1 }}>{label}</span>
      {keys.map((k, i) => <kbd key={i}>{k}</kbd>)}
    </div>
  );
  return (
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="pal card pop" role="dialog" aria-label="Keyboard shortcuts" style={{ padding: "18px 22px" }}>
        <div className="row" style={{ marginBottom: 8 }}>
          <b style={{ fontSize: 15, flexGrow: 1 }}>Keyboard shortcuts</b>
          <kbd>ESC</kbd>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", columnGap: 28 }}>
          <div>
            <div className="eyebrow" style={{ fontSize: 10, margin: "8px 0 4px" }}>Anywhere</div>
            {row(["Ctrl", "K"], "Search, run or ask")}
            {row(["/"], "Same, without Ctrl")}
            {row(["?"], "This list")}
            {row(["Ctrl", "↵"], "Send / build in text boxes")}
          </div>
          <div>
            <div className="eyebrow" style={{ fontSize: 10, margin: "8px 0 4px" }}>Go to — press g, then</div>
            {JUMPS.map(([k, , label]) => row(["g", k === "," ? "," : k.toUpperCase()], label))}
          </div>
        </div>
      </div>
    </div>
  );
}
