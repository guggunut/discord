import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type Me } from "./api";
import { play } from "./sfx";
import { Curtain, HelpPanel, Icon, P, Rail, Topbar, type Route } from "./ui";
import { Login } from "./pages/Login";
import { Command } from "./pages/Command";
import { Agents } from "./pages/Agents";
import { Code } from "./pages/Code";
import { Apps } from "./pages/Apps";
import { Settings } from "./pages/Settings";
import { Account } from "./pages/Account";
import { Guide } from "./pages/Guide";
import { Academy } from "./pages/Academy";
import { Soon } from "./pages/Soon";

interface Ctx {
  me: Me;
  refresh: () => Promise<void>;
  toast: (text: string, kind?: "ok" | "err") => void;
  go: (r: Route) => void;
}
const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => useContext(AppCtx)!;

const ROUTES: Route[] = ["command", "agents", "code", "apps", "ventures", "markets", "studio", "growth", "flows", "academy", "guide", "settings", "account"];
const readRoute = (): Route => {
  const r = location.hash.replace(/^#\/?/, "") as Route;
  return ROUTES.includes(r) ? r : "command";
};

export const META: Record<Route, { title: string; section: string; icon: string; tips: string[] }> = {
  command: { title: "Command center", section: "Workspace", icon: "Command", tips: ["Pick agents on the left — your message goes to all of them, and they build on each other’s answers.", "Drag the core to spin it. Click it to pulse. Modes change its shape.", "Engine decides who answers: Claude, Claude Code, a local model, or Auto."] },
  agents: { title: "Agent room", section: "Workspace", icon: "Agents", tips: ["Each AI has its own chat, history and settings.", "Set an engine per AI — Forge defaults to Auto, which uses Claude Code for repo work.", "Clear a chat any time from the Settings tab."] },
  code: { title: "Code", section: "Build", icon: "Code", tips: ["Describe what you want in the vibe box — Forge writes the files.", "Claude API writes files directly; Claude Code works inside the folder and can run tests.", "The preview runs in a sandbox and refreshes after each change."] },
  apps: { title: "Apps", section: "Build", icon: "Apps", tips: ["Connect GitHub with a fine-grained token to list and clone repos.", "Claude Code is detected automatically if it’s installed.", "Everything you connect lives in your personal vault."] },
  ventures: { title: "Ventures", section: "Money", icon: "Ventures", tips: ["Coming in v0.2 — see the design canvas for the full screen."] },
  markets: { title: "Markets", section: "Money", icon: "Markets", tips: ["Coming in v0.2 — ask Quant in the Agent room meanwhile."] },
  studio: { title: "Studio", section: "Create", icon: "Studio", tips: ["Coming in v0.2 — Muse can already write prompts and briefs."] },
  growth: { title: "Growth", section: "Create", icon: "Growth", tips: ["Coming in v0.2 — Echo can already plan posts."] },
  flows: { title: "Flows", section: "Automate", icon: "Flows", tips: ["Coming in v0.2 — Relay can already design flows with you."] },
  academy: { title: "Academy", section: "Learn", icon: "Academy", tips: ["Pick a playbook, tick steps as you go.", "Run with agents sends the playbook to the right AIs."] },
  guide: { title: "Setup guide", section: "Learn", icon: "Guide", tips: ["Five steps: engines, access, test, create an AI, first job.", "Keys are tested before they’re saved."] },
  settings: { title: "Settings", section: "System", icon: "Settings", tips: ["API keys live in your encrypted vault.", "Engines decide when to use Claude, Claude Code or local models.", "Sound & motion tunes effects."] },
  account: { title: "Account", section: "System", icon: "Command", tips: ["Turn on two-factor sign-in with an authenticator app.", "Groups are optional — keys and AIs always stay yours."] },
};

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [checked, setChecked] = useState(false);
  const [route, setRoute] = useState<Route>(readRoute);
  const [help, setHelp] = useState(false);
  const [toastMsg, setToast] = useState<{ text: string; kind: "ok" | "err"; id: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/me"));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setMe(null);
    } finally {
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onHash = () => {
      setRoute(readRoute());
      setHelp(false);
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [refresh]);

  const toast = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    play(kind === "ok" ? "success" : "error");
    const id = Date.now();
    setToast({ text, kind, id });
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3200);
  }, []);

  if (!checked) return <div style={{ minHeight: "100vh", background: "#030303" }} />;
  if (!me) return <Login onDone={refresh} />;

  const m = META[route];
  const ctx: Ctx = { me, refresh, toast, go: (r) => (location.hash = `#/${r}`) };
  const page: Record<Route, ReactNode> = {
    command: <Command />,
    agents: <Agents />,
    code: <Code />,
    apps: <Apps />,
    ventures: <Soon route="ventures" />,
    markets: <Soon route="markets" />,
    studio: <Soon route="studio" />,
    growth: <Soon route="growth" />,
    flows: <Soon route="flows" />,
    academy: <Academy />,
    guide: <Guide />,
    settings: <Settings />,
    account: <Account />,
  };

  const chips: [string, boolean][] = [
    [me.engines.claudeKeys ? `${me.engines.claudeKeys} Claude key${me.engines.claudeKeys > 1 ? "s" : ""}` : "No Claude key yet", true],
    [me.engines.claudeCode.ok ? "Claude Code ready" : "Claude Code not found", false],
  ];

  return (
    <AppCtx.Provider value={ctx}>
      <div className="os">
        <Rail route={route} initial={(me.user.name || me.user.handle).charAt(0).toUpperCase()} />
        <main className="main" key={route}>
          <Curtain route={route} />
          <Topbar title={m.title} section={m.section} icon={m.icon} chips={chips} onHelp={() => setHelp((h) => !h)} />
          {page[route]}
          <HelpPanel open={help} onClose={() => setHelp((h) => !h)} tips={m.tips} />
        </main>
      </div>
      {toastMsg && (
        <div style={{ position: "fixed", left: 0, right: 0, bottom: 28, display: "flex", justifyContent: "center", zIndex: 95, pointerEvents: "none" }}>
          <div className="card pop" role="status" style={{ padding: "12px 18px", display: "flex", gap: 10, alignItems: "center", borderColor: toastMsg.kind === "err" ? "rgba(255,43,58,0.6)" : "rgba(255,255,255,0.2)" }}>
            <Icon d={toastMsg.kind === "err" ? P.alert : P.check} size={16} color={toastMsg.kind === "err" ? "#FF2B3A" : "#F4F4F5"} />
            <span style={{ fontSize: 13 }}>{toastMsg.text}</span>
          </div>
        </div>
      )}
    </AppCtx.Provider>
  );
}
