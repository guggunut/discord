import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { Brand, Icon, P } from "../ui";

interface AppsState {
  anthropic: { connected: boolean; keys: number };
  claudeCode: { ok: boolean; version: string };
  github: { connected: boolean; login: string | null };
  discord: { connected: boolean };
  local: { url: string; model: string };
}
interface Repo {
  fullName: string;
  name: string;
  private: boolean;
  description: string | null;
  updatedAt: string;
  language: string | null;
}

const SOON: [string, string, string][] = [
  ["shopify", "Shopify", "Orders and margins for Ledger"],
  ["stripe", "Stripe", "Payments and payouts"],
  ["roblox", "Roblox Open Cloud", "Game analytics and DevEx"],
  ["instagram", "Instagram", "Posts and insights for Echo"],
  ["tiktok", "TikTok", "Videos and ads"],
  ["youtube", "YouTube", "Uploads and analytics"],
  ["gcal", "Google Calendar", "Focus time for Tempo"],
  ["notion", "Notion", "Docs and playbooks"],
  ["slack", "Slack", "Talk to agents at work"],
  ["vercel", "Vercel", "Deploy what Forge builds"],
  ["alpaca", "Alpaca", "Market data, paper trading"],
];

function Tile({ brand, variant, name, status, on, children }: { brand: string; variant: "" | "tint" | "red" | "white"; name: string; status: string; on: boolean; children: ReactNode }) {
  return (
    <div className="card tilt rise" style={{ padding: 18, display: "flex", flexDirection: "column", gap: 12, borderColor: on ? "rgba(255,43,58,0.45)" : undefined }}>
      <div className="row" style={{ gap: 12 }}>
        <Brand name={brand} size={44} variant={variant} />
        <div style={{ flexGrow: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{name}</div>
          <div className="mono" style={{ fontSize: 10, letterSpacing: ".08em", color: on ? "#FF5A66" : "#A1A1AA" }}>
            {status}
          </div>
        </div>
        {on && <Icon d={P.check} size={18} sw={2.4} color="#FF2B3A" />}
      </div>
      {children}
    </div>
  );
}

export function Apps() {
  const { toast, refresh, go } = useApp();
  const [s, setS] = useState<AppsState | null>(null);
  const [ghToken, setGhToken] = useState("");
  const [repos, setRepos] = useState<Repo[] | null>(null);
  const [cloning, setCloning] = useState<string | null>(null);
  const [hook, setHook] = useState("");
  const [localUrl, setLocalUrl] = useState("");
  const [localModel, setLocalModel] = useState("");
  const [busy, setBusy] = useState("");

  const load = async () => {
    const v = await api<AppsState>("/api/apps");
    setS(v);
    setLocalUrl(v.local.url);
    setLocalModel(v.local.model);
    if (v.github.connected && !repos) api<Repo[]>("/api/apps/github/repos").then(setRepos).catch(() => {});
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  };

  if (!s) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="card hot rise d2" style={{ padding: 22, display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
        <div className="row">
          <Brand name="github" size={52} variant="white" />
          <Icon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" size={22} color="#FF2B3A" />
          <Brand name="claudecode" size={52} variant="red" />
        </div>
        <div style={{ flexGrow: 1, minWidth: 260 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>GitHub + Claude Code</div>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.55 }}>
            Connect GitHub, clone a repo, then open it in Code — Forge uses Claude Code to read, change and test it.
          </p>
        </div>
        <span className="stat">
          <i className={s.github.connected ? "" : "w"} />
          GitHub {s.github.connected ? "connected" : "not connected"}
        </span>
        <span className="stat">
          <i className={s.claudeCode.ok ? "" : "w"} />
          Claude Code {s.claudeCode.ok ? "found" : "not found"}
        </span>
      </div>

      <div className="k3" style={{ gap: 18 }}>
        <Tile brand="anthropic" variant="red" name="Claude API" status={s.anthropic.connected ? `CONNECTED · ${s.anthropic.keys} KEY${s.anthropic.keys > 1 ? "S" : ""}` : "NOT CONNECTED"} on={s.anthropic.connected}>
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>Every agent’s thinking. Add up to three keys — the router rotates between them when one is rate-limited.</p>
          <a href="#/settings" className="btn">{s.anthropic.connected ? "Manage keys" : "Add a key"}</a>
        </Tile>

        <Tile brand="claudecode" variant="tint" name="Claude Code" status={s.claudeCode.ok ? s.claudeCode.version.toUpperCase() : "NOT INSTALLED"} on={s.claudeCode.ok}>
          <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            {s.claudeCode.ok ? "Detected on this computer. Used automatically for code work." : "Install it to let Forge edit real files and run tests."}
          </p>
          {s.claudeCode.ok ? <a href="#/code" className="btn">Open Code</a> : <a href="#/guide" className="btn">How to install</a>}
        </Tile>

        <Tile brand="discord" variant="tint" name="Discord alerts" status={s.discord.connected ? "CONNECTED" : "WEBHOOK"} on={s.discord.connected}>
          {s.discord.connected ? (
            <button type="button" className="btn" onClick={() => run("discord-x", async () => (await api("/api/apps/discord", { method: "DELETE" }), await load(), toast("Disconnected Discord.")))}>
              Disconnect
            </button>
          ) : (
            <>
              <label className="sr" htmlFor="hook">Discord webhook URL</label>
              <input id="hook" className="field mono" style={{ fontSize: 12 }} placeholder="https://discord.com/api/webhooks/…" value={hook} onChange={(e) => setHook(e.target.value)} />
              <button type="button" className="btn btn-red" disabled={busy === "discord"} onClick={() => run("discord", async () => (await api("/api/apps/discord", { body: { url: hook } }), setHook(""), await load(), toast("Sent a test message to Discord.")))}>
                {busy === "discord" ? "Testing…" : "Test & connect"}
              </button>
            </>
          )}
        </Tile>
      </div>

      <div className="g2r" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
        <div className="card rise d3" style={{ padding: 22 }}>
          <div className="row" style={{ marginBottom: 14 }}>
            <Brand name="github" size={40} variant={s.github.connected ? "white" : "tint"} />
            <div style={{ flexGrow: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>GitHub</div>
              <div className="muted" style={{ fontSize: 12 }}>{s.github.connected ? `Signed in as @${s.github.login}` : "Use a fine-grained personal access token"}</div>
            </div>
            {s.github.connected && (
              <button type="button" className="chip" onClick={() => run("gh-x", async () => (await api("/api/apps/github", { method: "DELETE" }), setRepos(null), await load(), void refresh(), toast("Disconnected GitHub.")))}>
                Disconnect
              </button>
            )}
          </div>
          {!s.github.connected ? (
            <div className="tx-rise" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.8 }}>
                <li>
                  Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → Fine-grained tokens</a>.
                </li>
                <li>Pick the repos GUG-cli may use. Give <b>Contents: Read</b> (add Write if you want Forge to push).</li>
                <li>Paste the token here. It’s stored encrypted on this computer.</li>
              </ol>
              <div className="row">
                <label className="sr" htmlFor="ght">GitHub token</label>
                <input id="ght" type="password" className="field mono" style={{ flexGrow: 1, fontSize: 12 }} placeholder="github_pat_…" value={ghToken} onChange={(e) => setGhToken(e.target.value)} />
                <button type="button" className="btn btn-red" disabled={busy === "gh"} onClick={() => run("gh", async () => {
                  const r = await api<{ login: string }>("/api/apps/github", { body: { token: ghToken } });
                  setGhToken("");
                  await load();
                  setRepos(await api<Repo[]>("/api/apps/github/repos"));
                  void refresh();
                  toast(`Connected as @${r.login}`);
                })}>
                  {busy === "gh" ? "Checking…" : "Connect"}
                </button>
              </div>
            </div>
          ) : (
            <div className="tx-wipe scroll" style={{ display: "flex", flexDirection: "column", maxHeight: 440 }}>
              {!repos && <div className="muted" style={{ fontSize: 13 }}>Loading repos…</div>}
              {repos?.map((r) => (
                <div key={r.fullName} className="row" style={{ minHeight: 58, borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "6px 0" }}>
                  <Icon d={P.branch} size={16} color="#FF2B3A" />
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div className="mono" style={{ fontSize: 13 }}>
                      {r.fullName} {r.private && <span className="chip" style={{ height: 20, fontSize: 10, marginLeft: 6 }}>private</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {r.description ?? "No description"} {r.language ? `· ${r.language}` : ""}
                    </div>
                  </div>
                  <button type="button" className="btn" style={{ height: 36, fontSize: 12 }} disabled={!!cloning} onClick={() => {
                    setCloning(r.fullName);
                    void run("clone", async () => {
                      const { project } = await api<{ project: string }>("/api/apps/github/clone", { body: { repo: r.fullName } });
                      localStorage.setItem("gug-project", project);
                      toast(`Cloned into ${project}. Opening Code…`);
                      go("code");
                    }).finally(() => setCloning(null));
                  }}>
                    {cloning === r.fullName ? "Cloning…" : "Open in Code"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card rise d4" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 12, alignSelf: "start" }}>
          <div className="row">
            <Brand name="local" size={40} />
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Local model</div>
              <div className="muted" style={{ fontSize: 12 }}>Ollama or LM Studio on this computer</div>
            </div>
          </div>
          <label className="label">
            Server address
            <input className="field mono" style={{ fontSize: 12 }} value={localUrl} onChange={(e) => setLocalUrl(e.target.value)} />
          </label>
          <label className="label">
            Model name
            <input className="field mono" style={{ fontSize: 12 }} placeholder="the name you pulled, e.g. via ollama pull" value={localModel} onChange={(e) => setLocalModel(e.target.value)} />
          </label>
          <button type="button" className="btn btn-white" onClick={() => run("local", async () => (await api("/api/prefs", { method: "PATCH", body: { localUrl, localModel } }), await load(), void refresh(), toast("Saved local model settings.")))}>
            Save
          </button>
        </div>
      </div>

      <div>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Coming soon</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 }}>
          {SOON.map(([b, n, d], i) => (
            <div key={b} className="card rise" style={{ padding: 16, display: "flex", gap: 12, alignItems: "center", opacity: 0.8, animationDelay: `${0.4 + i * 0.04}s` }}>
              <Brand name={b} size={38} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{n}</div>
                <div className="muted" style={{ fontSize: 12 }}>{d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
