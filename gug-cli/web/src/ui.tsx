import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { getSfx, onSfxChange, setSfx } from "./sfx";

// ---------- icons ----------
export const P: Record<string, string> = {
  Command: "M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  Agents: "M4 4h11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM20 9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2v3l-4-3h-4",
  Code: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16",
  Apps: "M5 3h3.5a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM15.5 3H19a2 2 0 0 1 2 2v3.5a2 2 0 0 1-2 2h-3.5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM5 13.5h3.5a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3.5a2 2 0 0 1 2-2zM17.25 13.5v7.5M13.5 17.25H21",
  Ventures: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  Markets: "M3 17l6-6 4 4 8-8M15 7h6v6",
  Studio: "M6 4h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM9 8a2 2 0 1 0 0 4a2 2 0 1 0 0-4M21 16l-5-5-9 9",
  Growth: "M3 11v2a1 1 0 0 0 1 1h3l8 4V6L7 10H4a1 1 0 0 0-1 1zM19 9a4 4 0 0 1 0 6",
  Flows: "M6 3.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M18 3.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M18 15.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M8.5 6h7M6 8.5V12a3.5 3.5 0 0 0 3.5 3.5h6",
  Academy: "M2 6l10-4 10 4-10 4zM6 8v6c0 1.7 2.7 3 6 3s6-1.3 6-3V8M22 6v6",
  Guide: "M9 7V3M15 7V3M6 7h12v4a6 6 0 0 1-12 0zM12 17v4",
  Settings: "M4 7h10M18 7h2M4 17h4M12 17h8M16 5a2 2 0 1 0 0 4a2 2 0 1 0 0-4M10 15a2 2 0 1 0 0 4a2 2 0 1 0 0-4",
  search: "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14M20 20l-4-4",
  send: "M12 19V5M6 11l6-6 6 6",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14M13 6l6 6-6 6",
  lock: "M6.5 10h11a2.5 2.5 0 0 1 2.5 2.5v6a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10zM8 10V7a4 4 0 0 1 8 0v3",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12l2 2 4-4",
  sound: "M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  mute: "M4 9v6h4l5 4V5L8 9zM17 9l5 6M22 9l-5 6",
  help: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17.2v.3",
  terminal: "M5.5 4h13A2.5 2.5 0 0 1 21 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4zM7 9l3 3-3 3M12.5 15H17",
  file: "M6 2.5h8l4 4v15H6zM14 2.5v4h4",
  folder: "M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z",
  wand: "M4 20L15 9M14 4v3M19 9h-3M17.5 5.5l-1.8 1.8M10 6.5V8M18 14v1.5",
  copy: "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8",
  group: "M8 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6M16 6a3 3 0 1 0 0 6a3 3 0 1 0 0-6M2.5 19a5.5 5.5 0 0 1 11 0M10.5 19a5.5 5.5 0 0 1 11 0",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11",
  refresh: "M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4",
  play: "M8 5l11 7-11 7z",
  alert: "M12 3l10 18H2zM12 10v4M12 17.5v.5",
  mic: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3M5 11a7 7 0 0 0 14 0M12 18v3",
  branch: "M6 2.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4M6 16.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4M18 5.8a2.2 2.2 0 1 0 0 4.4a2.2 2.2 0 1 0 0-4.4M6 7.2v9.6M18 10.2c0 4-6 3-11 6.5",
  down: "M6 9l6 6 6-6",
};

export function Icon({ d, size = 18, sw = 1.7, color = "currentColor", style }: { d: string; size?: number; sw?: number; color?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>
      <path d={d} />
    </svg>
  );
}

export const I = (name: keyof typeof P | string, size?: number, color?: string) => <Icon d={P[name] ?? name} size={size} color={color} />;

// ---------- agents ----------
export const RED = "#FF2B3A";
export const WHITE = "#F4F4F5";
export const AGENT_META: Record<string, { sig: string; tone: string }> = {
  atlas: { sig: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 1v4M12 19v4M1 12h4M19 12h4", tone: RED },
  ledger: { sig: "M4 20V11M10 20V5M16 20v-7M21 20H3", tone: WHITE },
  quant: { sig: "M12 3l10 17H2zM12 10l4 7H8z", tone: WHITE },
  muse: { sig: "M12 2l2.6 7.4L22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z", tone: RED },
  echo: { sig: "M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4", tone: WHITE },
  relay: { sig: "M4 4h5v5H4zM15 15h5v5h-5zM9 6.5h4.5A2.5 2.5 0 0 1 16 9v6", tone: WHITE },
  scout: { sig: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M15.5 8.5l-2 5-5 2 2-5z", tone: WHITE },
  forge: { sig: "M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16", tone: RED },
  vox: { sig: "M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3M5 11a7 7 0 0 0 14 0M12 18v3", tone: WHITE },
  tempo: { sig: "M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9", tone: WHITE },
  sage: { sig: "M2 8l10-5 10 5-10 5zM6 10v5c3 2.5 9 2.5 12 0v-5", tone: WHITE },
  sentinel: { sig: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6zM9 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0", tone: RED },
  you: { sig: "M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8M4 21a8 8 0 0 1 16 0", tone: WHITE },
};

export function Sigil({ id, size = 36, glow = true }: { id: string; size?: number; glow?: boolean }) {
  const m = AGENT_META[id] ?? AGENT_META.you;
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, width: size, height: size, borderRadius: size * 0.3, display: "grid", placeItems: "center", background: "#0A0A0B", border: "1px solid rgba(255,255,255,0.12)", boxShadow: glow ? `0 0 22px -8px ${m.tone}` : undefined }}>
      <Icon d={m.sig} size={size * 0.5} color={m.tone} sw={1.6} />
    </span>
  );
}

// ---------- brand glyphs (simplified, tinted) ----------
export const BRAND: Record<string, ReactNode> = {
  github: <path d="M9 19c-4 1.5-4-2-6-2.5m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.7 4.7 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.7 11.7 0 0 0-6.2 0C6.6 2.7 5.6 3 5.6 3a4.2 4.2 0 0 0-.1 3.2A4.7 4.7 0 0 0 4.2 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />,
  anthropic: <path d="M13.6 4h3.1L23 20h-3.1zM7.3 4h3.2l6.2 16h-3.2l-1.3-3.4H5.6L4.3 20H1.1zM6.7 13.9h4.3L8.8 8.3z" fill="currentColor" stroke="none" />,
  claudecode: <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9.5l3 2.5-3 2.5M12.5 15H17" /></>,
  local: <><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></>,
  discord: <><path d="M8 6.5c2.6-1 5.4-1 8 0 1.6 2.4 2.5 5 2.6 8.2-1.5 1.2-3 1.9-4.4 2.3l-1-1.6M8 6.5C6.4 8.9 5.5 11.5 5.4 14.7c1.5 1.2 3 1.9 4.4 2.3l1-1.6" /><path d="M8.6 15.2c2.2.9 4.6.9 6.8 0" /></>,
  shopify: <><path d="M5.5 7.5L7 6.6l.6-1.8C8.2 3 9.4 2 10.8 2s2.2 1 2.5 2.4l1.9-.6L18 20.5l-12.6.9z" /><path d="M13.6 10.4c-.7-.5-1.6-.6-2.2-.3-.9.4-.7 1.4.3 1.8 1 .4 1.5 1.1 1.1 1.9-.5.9-1.7 1-2.7.3" /></>,
  roblox: <><path d="M6.8 3.2l14 3.6-3.6 14-14-3.6z" /><path d="M10.6 9.3l4.1 1-1 4.1-4.1-1z" fill="currentColor" stroke="none" /></>,
  instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4.2" /></>,
  tiktok: <path d="M14 3v11.5a3.6 3.6 0 1 1-3.6-3.6M14 3c.4 2.6 2.4 4.6 5.2 4.8" strokeWidth="2.2" />,
  youtube: <><rect x="2.5" y="5.5" width="19" height="13" rx="4" /><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" stroke="none" /></>,
  stripe: <path d="M16 7.8c-1-.6-2.4-1-3.7-1-2 0-3.2.9-3.2 2.2 0 3.1 7.1 1.9 7.1 6 0 1.7-1.6 2.9-4 2.9-1.6 0-3.2-.5-4.3-1.1" strokeWidth="2.2" />,
  notion: <><rect x="4" y="3" width="16" height="18" rx="2.5" /><path d="M8.5 16.5v-9l7 9v-9" /></>,
  gcal: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  slack: <path d="M9.5 3.5v7M14.5 13.5v7M3.5 14.5h7M13.5 9.5h7" strokeWidth="2.6" />,
  vercel: <path d="M12 4l9 16H3z" fill="currentColor" stroke="none" />,
  alpaca: <path d="M4 20L10 4h3l7 16M7.5 13h9" />,
};

export function Brand({ name, size = 40, variant = "tint" }: { name: string; size?: number; variant?: "" | "tint" | "red" | "white" }) {
  return (
    <span className={`brand ${variant}`} aria-hidden="true" style={{ width: size, height: size, borderRadius: size * 0.3 }}>
      <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
        {BRAND[name]}
      </svg>
    </span>
  );
}

// ---------- controls ----------
export function Seg<T extends string>({ value, options, onChange, width, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; width?: number | string; label: string }) {
  const i = Math.max(0, options.findIndex(([v]) => v === value));
  const n = options.length;
  return (
    <div className="seg" role="tablist" aria-label={label} style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, width }}>
      <span className="ind" aria-hidden="true" style={{ left: `calc(4px + ${i} * (100% - 8px) / ${n})`, width: `calc((100% - 8px) / ${n})` }} />
      {options.map(([v, l]) => (
        <button key={v} type="button" role="tab" aria-selected={v === value} onClick={() => onChange(v)} style={{ color: v === value ? "#050505" : "#A1A1AA" }}>
          {l}
        </button>
      ))}
    </div>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" className="switch" aria-pressed={on} aria-label={label} onClick={() => onChange(!on)} style={{ background: on ? RED : "rgba(255,255,255,0.14)", boxShadow: on ? "0 0 18px -2px rgba(255,43,58,0.8)" : "none" }}>
      <span style={{ left: on ? 21 : 3 }} />
    </button>
  );
}

export function useSfxPrefs() {
  const [, force] = useState(0);
  useEffect(() => onSfxChange(() => force((n) => n + 1)), []);
  return getSfx();
}

// ---------- shell ----------
export type Route = "command" | "agents" | "code" | "apps" | "ventures" | "markets" | "studio" | "growth" | "flows" | "academy" | "guide" | "settings" | "account";
export const NAV: [Route, string, string][] = [
  ["command", "Command", "Command"],
  ["agents", "Agent room", "Agents"],
  ["code", "Code", "Code"],
  ["apps", "Apps", "Apps"],
  ["ventures", "Ventures", "Ventures"],
  ["markets", "Markets", "Markets"],
  ["studio", "Studio", "Studio"],
  ["growth", "Growth", "Growth"],
  ["flows", "Flows", "Flows"],
  ["academy", "Academy", "Academy"],
  ["guide", "Setup guide", "Guide"],
];
const CURTAIN: Record<Route, string> = { command: "cv-wipe", agents: "cv-iris", code: "cv-code", apps: "cv-split", ventures: "cv-blinds", markets: "cv-scan", studio: "cv-zoom", growth: "cv-diag", flows: "cv-hblinds", academy: "cv-fold", guide: "cv-iris", settings: "cv-shutter", account: "cv-split" };

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="#F4F4F5" strokeWidth="2.6" strokeDasharray="58 21" transform="rotate(-38 16 16)" />
      <path d="M16 16h9.5" stroke={RED} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.4" fill={RED} />
    </svg>
  );
}

export function Rail({ route, initial }: { route: Route; initial: string }) {
  const link = (r: Route, label: string, icon: string) => (
    <a key={r} href={`#/${r}`} className={route === r ? "on" : undefined} aria-current={route === r ? "page" : undefined} aria-label={label} data-tip={label}>
      <Icon d={P[icon]} size={20} sw={1.6} />
    </a>
  );
  return (
    <nav className="rail" aria-label="Main" style={{ gap: 4 }}>
      <a href="#/command" aria-label="GUG-cli home" data-tip="GUG-cli" style={{ marginBottom: 14, border: 0, background: "transparent" }}>
        <Logo />
      </a>
      {NAV.map(([r, l, i]) => link(r, l, i))}
      <div style={{ flexGrow: 1, minHeight: 12 }} />
      {link("settings", "Settings", "Settings")}
      <a href="#/account" aria-label="Account" data-tip="Account" className={route === "account" ? "on" : undefined} style={{ marginTop: 6, borderRadius: "50%" }}>
        <span className="disp" style={{ width: 36, height: 36, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 13, color: "#050505", background: WHITE, boxShadow: `0 0 0 2px #030303, 0 0 0 3.5px ${RED}` }}>
          {initial}
        </span>
      </a>
    </nav>
  );
}

export function Topbar({ title, section, icon, chips = [], right, onHelp }: { title: string; section: string; icon: string; chips?: [string, boolean][]; right?: ReactNode; onHelp: () => void }) {
  const sfx = useSfxPrefs();
  return (
    <header className="topbar rise" style={{ animationDelay: ".25s" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexGrow: 1, minWidth: 260 }}>
        <span className="tb-ic">
          <Icon d={P[icon]} size={19} />
        </span>
        <div>
          <div className="crumb">
            GUG-cli / <b>{section}</b>
          </div>
          <h1 className="tb-title">{title}</h1>
        </div>
        <div className="hide-sm" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: 8 }}>
          {chips.map(([t, red]) => (
            <span key={t} className="stat">
              <i className={red ? "" : "w"} />
              {t}
            </span>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {right}
        <button type="button" className="btn iconbtn" data-sfx="toggle" aria-pressed={!sfx.muted} aria-label={sfx.muted ? "Turn sound on" : "Mute sounds"} title={sfx.muted ? "Sound off" : "Sound on"} onClick={() => setSfx({ muted: !sfx.muted })}>
          {sfx.muted ? <Icon d={P.mute} size={17} color={RED} /> : <Icon d={P.sound} size={17} />}
        </button>
        <button type="button" className="btn iconbtn" aria-label="Help for this screen" title="Help" onClick={onHelp}>
          <Icon d={P.help} size={17} />
        </button>
      </div>
    </header>
  );
}

export function Curtain({ route }: { route: Route }) {
  return <div key={route} className={`cv ${CURTAIN[route]}`} aria-hidden="true" />;
}

export function HelpPanel({ open, onClose, tips }: { open: boolean; onClose: () => void; tips: string[] }) {
  return (
    <>
      <button type="button" className="help-fab" aria-label="Help" aria-expanded={open} onClick={onClose}>
        <Icon d={P.help} size={22} />
      </button>
      {open && (
        <div className="help-panel card pop" role="dialog" aria-label="Tips for this screen" style={{ padding: 18, borderColor: "rgba(255,43,58,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <Sigil id="sage" size={30} glow={false} />
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Quick tips</div>
              <div style={{ fontSize: 11, color: "#A1A1AA" }}>From Sage, your tutor agent</div>
            </div>
            <button type="button" className="btn iconbtn" aria-label="Close tips" style={{ width: 32, height: 32 }} onClick={onClose}>
              <Icon d={P.x} size={14} />
            </button>
          </div>
          {tips.map((t, i) => (
            <div key={t} className="rise" style={{ display: "flex", gap: 10, padding: "8px 0", fontSize: 13, lineHeight: 1.5, color: "#D4D4D8", animationDelay: `${0.05 + i * 0.08}s` }}>
              <span className="mono" style={{ color: RED, fontSize: 11, marginTop: 2 }}>
                0{i + 1}
              </span>
              <span>{t}</span>
            </div>
          ))}
          <a href="#/guide" className="btn" style={{ width: "100%", marginTop: 12, height: 40 }} onClick={onClose}>
            Open the setup guide <Icon d={P.arrow} size={14} />
          </a>
        </div>
      )}
    </>
  );
}

export function Toast({ text, kind }: { text: string; kind: "ok" | "err" }) {
  return (
    <div className="card pop" role="status" style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 90, padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", borderColor: kind === "err" ? "rgba(255,43,58,0.6)" : "rgba(255,255,255,0.2)" }}>
      <Icon d={kind === "err" ? P.alert : P.check} size={16} color={kind === "err" ? RED : WHITE} />
      <span style={{ fontSize: 13 }}>{text}</span>
    </div>
  );
}
