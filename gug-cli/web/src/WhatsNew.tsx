// "What's new" — opens once after an update, and any time from the palette.
import { useEffect, useState } from "react";
import { play } from "./sfx";
import { Icon, P, type Route } from "./ui";

export const VERSION = "0.3.0";
const ITEMS: [Route, string, string, string][] = [
  ["code", "Code", "Build in Blender & Roblox Studio", "Connect apps through MCP, then watch Live view: Blender's viewport (or any window you share) updates as Forge works, and the filmstrip replays the build as a timelapse."],
  ["agents", "Agents", "Forge talks to Blender", "Once an app is connected, Forge and Muse can use it from any chat — “what's in my scene?”, “add a rim light”. Try its tools by hand in Connect apps → Tools."],
  ["code", "Code", "See every change, undo any build", "The Changes tab diffs what Forge did, line by line. Didn't like it? Undo build puts every file back."],
  ["agents", "Agents", "Your aesthetic, every AI", "Give each agent its own profile picture — crop it, then go mono, red or duotone to match the rest."],
  ["ventures", "Ventures", "Charts you can spin", "Bar charts are real 3D now: drag to orbit, hover to lift a bar, click to pin it."],
  ["ventures", "Ventures", "Ventures", "Track every store, game and product — Shopify order sync (or CSV), live Roblox player stats, a monthly goal, charts and a Ledger review."],
  ["markets", "Markets", "Markets", "Live watchlist, charts, headlines, price alerts and a $10k paper-trading account. Quant explains — never advises."],
  ["studio", "Studio", "Studio", "Muse draws vector art, Beats is a 16-step drum machine, the Shorts maker turns art + captions + your beat into 9:16 videos, and Vox does voiceovers."],
  ["growth", "Growth", "Growth", "A content calendar Echo can fill, one-click Discord posts, and when your posts do best."],
  ["agents", "Agents", "Agents with tools", "Agents now read and act on your data (with your say-so), share a memory of you, and offer starter prompts."],
  ["command", "Command", "Team mode + voice", "Atlas hands tasks to the right agents and wraps up. Speak instead of typing. A live Today briefing."],
  ["flows", "Flows", "Smarter automations", "Weekly schedules, real data in every run, and desktop notifications for results and price alerts."],
  ["code", "Code", "Templates, devices & zip", "Start from a landing page, an arcade game or Roblox scripts; preview on desktop, tablet or phone; download any project."],
  ["settings", "Settings", "Router & backups", "See tokens per model and what's cooling down; back up and restore everything (never your keys)."],
  ["apps", "Apps", "Local API", "Let your own Discord bot ask your agents — ready-made slash command included."],
];

export function WhatsNew({ go }: { go: (r: Route) => void }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("gug-seen-version") !== VERSION;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("gug-whatsnew", show);
    return () => window.removeEventListener("gug-whatsnew", show);
  }, []);
  const close = () => {
    setOpen(false);
    try {
      localStorage.setItem("gug-seen-version", VERSION);
    } catch {
      /* private mode */
    }
  };
  if (!open) return null;
  return (
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal card pop" role="dialog" aria-label="What's new" style={{ width: "min(760px, 100%)", padding: "22px 22px 16px" }}>
        <div className="row" style={{ marginBottom: 4 }}>
          <span className="eyebrow" style={{ fontSize: 10, color: "#FF5A66", flexGrow: 1 }}>What’s new · v{VERSION}</span>
          <button type="button" className="chip" aria-label="Close" onClick={close}><Icon d={P.x} size={12} /></button>
        </div>
        <h2 className="disp" style={{ margin: "4px 0 14px", fontSize: 26, fontWeight: 300 }}>Every screen is real now<span style={{ color: "#FF2B3A" }}>.</span></h2>
        <div className="scroll" style={{ maxHeight: "60vh", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 8 }}>
          {ITEMS.map(([r, icon, title, desc], i) => (
            <button key={title} type="button" className="listbtn rise" style={{ alignItems: "flex-start", padding: 12, minHeight: 0, borderRadius: 14, border: "1px solid rgba(255,255,255,0.06)", animationDelay: `${i * 0.04}s` }} onClick={() => (close(), play("nav"), go(r))}>
              <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", flexShrink: 0, background: i < 4 ? "rgba(255,43,58,0.14)" : "rgba(255,255,255,0.05)", color: i < 4 ? "#FF2B3A" : "#F4F4F5" }}>
                <Icon d={P[icon]} size={17} />
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{title}</span>
                <span className="muted" style={{ display: "block", fontSize: 12, lineHeight: 1.45, marginTop: 2 }}>{desc}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="row muted" style={{ fontSize: 11, marginTop: 12, gap: 14, flexWrap: "wrap" }}>
          <span>Also: <kbd>Ctrl</kbd> <kbd>K</kbd> palette · <kbd>?</kbd> shortcuts · Focus timer in the top bar · <code className="mono">gug today</code> in the terminal</span>
          <span style={{ flexGrow: 1 }} />
          <button type="button" className="btn btn-red" style={{ height: 38 }} onClick={close}>Let’s go</button>
        </div>
      </div>
    </div>
  );
}
