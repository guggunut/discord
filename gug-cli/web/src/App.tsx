import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type State } from "./api";
import { play } from "./sfx";
import { Curtain, HelpPanel, Icon, P, Rail, Topbar, type Route } from "./ui";
import { MiniPlayer, MediaProvider } from "./Media";
import { Locked } from "./pages/Locked";
import { Command } from "./pages/Command";
import { Agents } from "./pages/Agents";
import { Code } from "./pages/Code";
import { Apps } from "./pages/Apps";
import { Settings } from "./pages/Settings";
import { Account } from "./pages/Account";
import { Guide } from "./pages/Guide";
import { Academy } from "./pages/Academy";
import { Soon } from "./pages/Soon";
import { Flows } from "./pages/Flows";

interface Ctx {
  state: State;
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
  agents: { title: "Agent room", section: "Workspace", icon: "Agents", tips: ["Each AI has its own chat, history and settings.", "Set an engine per AI — Forge uses Claude Code for repo work when it’s installed.", "Clear a chat any time from the Settings tab."] },
  code: { title: "Code", section: "Build", icon: "Code", tips: ["Describe what you want in the vibe box — Forge writes the files.", "Claude API writes files directly; Claude Code works inside the folder and can run tests.", "The preview runs in a sandbox and refreshes after each change."] },
  apps: { title: "Apps", section: "Build", icon: "Apps", tips: ["Connect GitHub with a fine-grained token to list and clone repos.", "Claude Code is detected automatically if it’s installed.", "Everything you connect is stored encrypted on this computer."] },
  ventures: { title: "Ventures", section: "Money", icon: "Ventures", tips: ["Coming next — Ledger can already work through numbers with you in the Agent room."] },
  markets: { title: "Markets", section: "Money", icon: "Markets", tips: ["Coming next — ask Quant in the Agent room meanwhile. Not financial advice."] },
  studio: { title: "Studio", section: "Create", icon: "Studio", tips: ["Coming next — Muse can already write prompts and briefs."] },
  growth: { title: "Growth", section: "Create", icon: "Growth", tips: ["Coming next — Echo can already plan posts."] },
  flows: { title: "Flows", section: "Automate", icon: "Flows", tips: ["A flow runs agents on a schedule and drops the result in your inbox or Discord.", "Each step sees the step before — use {{previous}} to place it.", "Scheduled flows run while gug serve is running."] },
  academy: { title: "Academy", section: "Learn", icon: "Academy", tips: ["Pick a playbook, tick steps as you go — progress is saved in this browser.", "Run with agents sends the playbook to the right AIs."] },
  guide: { title: "Setup guide", section: "Learn", icon: "Guide", tips: ["Five steps: engines, access, test, create an AI, first job.", "Keys are tested before they’re saved."] },
  settings: { title: "Settings", section: "System", icon: "Settings", tips: ["API keys are encrypted on this computer.", "Engines decide when to use Claude, Claude Code or local models.", "Sound & motion tunes effects."] },
  account: { title: "This computer", section: "System", icon: "Command", tips: ["v1 runs locally — no sign-in needed.", "The local lock stops other programs and websites reaching GUG-cli.", "Rotate your private link if you think it leaked."] },
};

export function App() {
  const [state, setState] = useState<State | null>(null);
  const [locked, setLocked] = useState(false);
  const [route, setRoute] = useState<Route>(readRoute);
  const [help, setHelp] = useState(false);
  const [toastMsg, setToast] = useState<{ text: string; kind: "ok" | "err"; id: number } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setState(await api<State>("/api/state"));
      setLocked(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setLocked(true);
    }
  }, []);

  useEffect(() => {
    // `gug serve` opens #token=…; trade it for an httpOnly cookie and wipe it from the URL.
    const tryToken = async () => {
      const m = location.hash.match(/token=([\w-]+)/);
      if (!m) return false;
      try {
        await api("/api/unlock", { body: { token: m[1] } });
        play("boot");
      } catch {
        /* falls through to the locked screen */
      }
      history.replaceState(null, "", location.pathname + "#/command");
      setRoute("command");
      return true;
    };
    void tryToken().then(refresh);
    const onHash = () => {
      if (/token=/.test(location.hash)) {
        void tryToken().then(refresh);
        return;
      }
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
    window.setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3400);
  }, []);

  if (locked) return <Locked onUnlocked={refresh} />;
  if (!state) return <div style={{ minHeight: "100vh", background: "#030303" }} />;

  const m = META[route];
  const ctx: Ctx = { state, refresh, toast, go: (r) => (location.hash = `#/${r}`) };
  const page: Record<Route, ReactNode> = {
    command: <Command />,
    agents: <Agents />,
    code: <Code />,
    apps: <Apps />,
    ventures: <Soon route="ventures" />,
    markets: <Soon route="markets" />,
    studio: <Soon route="studio" />,
    growth: <Soon route="growth" />,
    flows: <Flows />,
    academy: <Academy />,
    guide: <Guide />,
    settings: <Settings />,
    account: <Account />,
  };
  const keys = state.engines.claudeKeys;
  const chips: [string, boolean][] = [
    [keys ? `${keys} Claude key${keys > 1 ? "s" : ""}` : "No Claude key yet", true],
    [state.engines.claudeCode.ok ? "Claude Code ready" : "Claude Code not found", false],
  ];
  const initial = (state.profile.name || "You").charAt(0).toUpperCase();

  return (
    <AppCtx.Provider value={ctx}>
      <MediaProvider>
        <div className="os">
          <Rail route={route} initial={initial} />
          <main className="main" key={route}>
            <Curtain route={route} />
            <Topbar title={m.title} section={m.section} icon={m.icon} chips={chips} right={<MiniPlayer />} onHelp={() => setHelp((h) => !h)} />
            {page[route]}
            <HelpPanel open={help} onClose={() => setHelp((h) => !h)} tips={m.tips} />
          </main>
        </div>
      </MediaProvider>
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
