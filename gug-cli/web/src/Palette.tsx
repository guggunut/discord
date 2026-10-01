// ⌘K / Ctrl+K command palette: jump anywhere, ask any agent, run quick actions.
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { getSfx, play, setSfx } from "./sfx";
import { Icon, NAV, P, Sigil, type Route } from "./ui";

interface Item {
  id: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  run: () => void;
  keywords?: string;
}

const AGENTS: [string, string][] = [
  ["atlas", "Orchestrator"], ["ledger", "Finance"], ["quant", "Markets"], ["muse", "Creative"], ["echo", "Marketing"], ["relay", "Automations"],
  ["scout", "Research"], ["forge", "Code"], ["vox", "Voice"], ["tempo", "Calendar"], ["sage", "Coach"], ["sentinel", "Security"],
];
const INTENT: Record<string, string[]> = {
  ledger: ["tax", "money", "profit", "margin", "revenue", "cost", "budget", "invoice", "price", "pricing", "income", "spend", "sales", "vat", "shopify", "dropship"],
  quant: ["stock", "stocks", "invest", "investing", "crypto", "bitcoin", "market", "portfolio", "etf", "fund", "shares", "trading"],
  muse: ["image", "logo", "design", "draw", "art", "thumbnail", "photo", "brand", "colour", "color", "video"],
  echo: ["post", "caption", "marketing", "tiktok", "instagram", "youtube", "ads", "ad", "followers", "content", "hook", "viral"],
  relay: ["automate", "automation", "webhook", "flow", "zap", "integrate", "integration", "trigger"],
  scout: ["research", "find", "compare", "trend", "trends", "competitor", "source", "supplier", "best"],
  forge: ["code", "app", "website", "bug", "repo", "script", "api", "deploy", "error", "build", "roblox", "lua"],
  vox: ["voice", "voiceover", "podcast", "narrate", "audio", "speech", "song", "music"],
  tempo: ["plan", "schedule", "calendar", "today", "tomorrow", "week", "routine", "deadline", "focus", "time"],
  sage: ["learn", "explain", "teach", "how", "why", "understand", "study", "homework", "revise"],
  sentinel: ["password", "security", "2fa", "hack", "hacked", "scam", "phishing", "key", "privacy", "safe"],
};
/** How strongly a question points at an agent's speciality. */
const intent = (id: string, text: string) => {
  const words = text.toLowerCase().split(/[^a-z0-9]+/);
  return (INTENT[id] ?? []).reduce((n, k) => n + (words.includes(k) ? 1 : 0), 0);
};
const NAME = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

/** Scores how well `q` matches `text` (subsequence, bonus for word starts). 0 = no match. */
export function score(q: string, text: string): number {
  if (!q) return 1;
  const t = text.toLowerCase();
  const s = q.toLowerCase();
  if (t.includes(s)) return 100 - t.indexOf(s);
  let i = 0;
  let pts = 0;
  for (let k = 0; k < t.length && i < s.length; k++) {
    if (t[k] === s[i]) {
      pts += k === 0 || t[k - 1] === " " ? 3 : 1;
      i++;
    }
  }
  return i === s.length ? pts : 0;
}

export function Palette({ go }: { go: (r: Route) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.matches("input, textarea, select") || e.target.isContentEditable);
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "/" && !typing && !open) {
        e.preventDefault();
        setOpen(true);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("gug-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gug-palette", onOpen);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ("");
      setAt(0);
      play("tab");
    }
  }, [open]);

  const close = () => setOpen(false);
  const prefill = (agent: string, text: string) => {
    localStorage.setItem("gug-agent", agent);
    localStorage.setItem("gug-prefill", text);
    go("agents");
    window.dispatchEvent(new Event("gug-prefill"));
  };

  const items = useMemo<Item[]>(() => {
    const text = q.trim();
    const out: Item[] = [];
    if (text) {
      // Specialists whose topic matches go first, then Atlas (who can pull in the others), then everyone else.
      const ranked = AGENTS.map(([id, role], k) => ({ id, role, s: id === "atlas" ? 0.5 : intent(id, text) - k / 100 })).sort((a, b) => b.s - a.s);
      for (const { id, role } of ranked) out.push({ id: `ask-${id}`, label: `Ask ${NAME(id)}: “${text}”`, hint: role, icon: <Sigil id={id} size={26} glow={false} />, run: () => prefill(id, text) });
      out.push({ id: "draw", label: `Draw “${text}” with Muse`, hint: "Studio", icon: <Icon d={P.Studio} size={18} />, run: () => (localStorage.setItem("gug-studio-prompt", text), go("studio")), keywords: `draw image art ${text}` });
      out.push({ id: "watch", label: `Watch ${text.toUpperCase()} in Markets`, hint: "Markets", icon: <Icon d={P.Markets} size={18} />, run: () => (localStorage.setItem("gug-markets-add", text), go("markets")), keywords: `ticker stock crypto watch ${text}` });
    }
    for (const [r, label, icon] of NAV) out.push({ id: `go-${r}`, label: `Go to ${label}`, hint: "Navigate", icon: <Icon d={P[icon]} size={18} />, run: () => go(r), keywords: `${r} ${label} open` });
    out.push({ id: "go-settings", label: "Go to Settings", hint: "Navigate", icon: <Icon d={P.Settings} size={18} />, run: () => go("settings"), keywords: "settings keys api preferences" });
    out.push({ id: "go-account", label: "Go to This computer", hint: "Navigate", icon: <Icon d={P.lock} size={18} />, run: () => go("account"), keywords: "account lock private link" });
    out.push({ id: "new-flow", label: "New automation", hint: "Flows", icon: <Icon d={P.Flows} size={18} />, run: () => go("flows"), keywords: "flow automation schedule" });
    out.push({ id: "log-sale", label: "Log a sale or cost", hint: "Ventures", icon: <Icon d={P.Ventures} size={18} />, run: () => go("ventures"), keywords: "money income sale cost refund" });
    out.push({ id: "plan-week", label: "Plan this week’s posts", hint: "Growth", icon: <Icon d={P.Growth} size={18} />, run: () => go("growth"), keywords: "content social calendar echo" });
    out.push({ id: "vibe", label: "Vibe-code something", hint: "Code", icon: <Icon d={P.Code} size={18} />, run: () => go("code"), keywords: "code build app website" });
    const muted = getSfx().muted;
    out.push({ id: "sound", label: muted ? "Turn sound effects on" : "Mute sound effects", hint: "Sound", icon: <Icon d={muted ? P.sound : P.mute} size={18} />, run: () => setSfx({ muted: !muted }), keywords: "sound audio mute volume" });
    out.push({ id: "whatsnew", label: "What’s new in GUG-cli", hint: "Help", icon: <Icon d={P.help} size={18} />, run: () => window.dispatchEvent(new Event("gug-whatsnew")), keywords: "new changes update release notes" });
    out.push({ id: "lock", label: "Lock GUG-cli in this browser", hint: "Security", icon: <Icon d={P.lock} size={18} />, run: () => void api("/api/lock", { body: {} }).then(() => location.reload()), keywords: "lock sign out logout" });
    for (const [id, role] of text ? [] : AGENTS) out.push({ id: `chat-${id}`, label: `Chat with ${NAME(id)}`, hint: role, icon: <Sigil id={id} size={26} glow={false} />, run: () => (localStorage.setItem("gug-agent", id), go("agents"), window.dispatchEvent(new Event("gug-prefill"))), keywords: `${id} ${role} agent ai` });
    if (!text) return out;
    return out
      .map((i, k) => ({ i, k, s: i.id.startsWith("ask-") || i.id === "draw" || i.id === "watch" ? 1 : score(text, `${i.label} ${i.keywords ?? ""}`) * 2 }))
      .filter((x) => x.s > 0)
      // Strong command matches (e.g. "markets") beat questions; otherwise keep the agent ranking order.
      .sort((a, b) => (b.s >= 40 || a.s >= 40 ? b.s - a.s : 0) || a.k - b.k)
      .map((x) => x.i);
  }, [q, open]);

  useEffect(() => setAt(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  }, [at]);

  if (!open) return null;
  const pick = (i: Item) => {
    close();
    play("confirm");
    i.run();
  };
  return (
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal card pop" role="dialog" aria-label="Command palette">
        <div className="row" style={{ padding: "4px 6px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
          <Icon d={P.search} size={17} color="#FF2B3A" />
          <input
            ref={input}
            autoFocus
            aria-label="Search commands or ask an agent"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") (e.preventDefault(), setAt((a) => Math.min(items.length - 1, a + 1)));
              else if (e.key === "ArrowUp") (e.preventDefault(), setAt((a) => Math.max(0, a - 1)));
              else if (e.key === "Enter" && items[at]) (e.preventDefault(), pick(items[at]));
              else if (e.key === "Escape") close();
            }}
            placeholder="Jump to a screen, or type a question for any agent…"
            style={{ flexGrow: 1, border: 0, outline: 0, background: "transparent", fontSize: 16, color: "#F4F4F5", height: 40 }}
          />
          <kbd className="mono">ESC</kbd>
        </div>
        <div ref={list} className="scroll" style={{ maxHeight: 420, padding: "8px 2px 2px" }} role="listbox">
          {items.map((i, k) => (
            <button key={i.id} type="button" role="option" aria-selected={k === at} data-i={k} data-sfx="none" className={`pal-item ${k === at ? "on" : ""}`} onMouseMove={() => setAt(k)} onClick={() => pick(i)}>
              <span className="pal-ic">{i.icon}</span>
              <span style={{ flexGrow: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.label}</span>
              <span className="mono muted" style={{ fontSize: 10, letterSpacing: ".08em" }}>{i.hint.toUpperCase()}</span>
            </button>
          ))}
          {!items.length && <div className="muted" style={{ padding: 16, fontSize: 13 }}>Nothing matches.</div>}
        </div>
        <div className="row mono muted" style={{ fontSize: 10, gap: 14, padding: "10px 8px 2px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
          <span><kbd>↵</kbd> run</span>
          <span style={{ flexGrow: 1 }} />
          <span><kbd>Ctrl</kbd> <kbd>K</kbd> or <kbd>/</kbd> anywhere</span>
        </div>
      </div>
    </div>
  );
}
