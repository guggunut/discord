import { useState } from "react";
import { api } from "../api";
import { useApp } from "../App";
import { Icon, P } from "../ui";

export function Account() {
  const { state, refresh, toast } = useApp();
  const [name, setName] = useState(state.profile.name);
  const initial = (state.profile.name || "You").charAt(0).toUpperCase();

  const saveName = async () => {
    await api("/api/profile", { method: "PATCH", body: { name } });
    await refresh();
    toast("Saved.");
  };
  const rotate = async () => {
    if (!confirm("Make a new private link? Old links (on other browsers) stop working.")) return;
    await api("/api/lock/rotate", { body: {} });
    toast("New link made. Run `gug link` to see it.");
  };
  const lock = async () => {
    await api("/api/lock", { body: {} });
    location.reload();
  };

  return (
    <div className="g2l cols" style={{ ["--cols" as string]: "300px minmax(0,1fr)" }}>
      <section className="card rise d2" style={{ padding: 24, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 10, alignSelf: "start" }}>
        <div className="stage" style={{ width: 132, height: 132, borderRadius: "50%", overflow: "visible" }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", border: "2px solid transparent", borderTopColor: "#FF2B3A", borderRightColor: "#FF2B3A", animation: "spinz 6s linear infinite", filter: "drop-shadow(0 0 6px #FF2B3A)" }} />
          <span style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "1px dashed rgba(255,255,255,0.2)", animation: "spinz 18s linear infinite reverse" }} />
          <span className="disp" style={{ width: 92, height: 92, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 34, color: "#050505", background: "#F4F4F5" }}>
            {initial}
          </span>
        </div>
        <label className="label" style={{ width: "100%", textAlign: "left", marginTop: 6 }}>
          Your name
          <input className="field" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveName()} placeholder="What should the agents call you?" />
        </label>
        <button type="button" className="btn" style={{ width: "100%" }} onClick={saveName}>
          Save name
        </button>
        <span className="stat">
          <i />
          Local profile
        </span>
        <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.5 }}>
          Since {new Date(state.profile.createdAt).toLocaleDateString()} · lives on this computer only
        </p>
      </section>

      <div style={{ display: "flex", flexDirection: "column", gap: 22, minWidth: 0 }}>
        <section className="card rise d3" style={{ padding: 26 }}>
          <div className="row" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, flexGrow: 1 }}>This computer</h2>
            <span className="stat">
              <i />
              v1 · runs locally
            </span>
          </div>
          <p className="muted" style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6 }}>
            GUG-cli runs on your machine, so there’s nothing to sign in to. Your keys, chats and projects stay here and are only sent to the AI provider you pick.
          </p>
          <div className="k3" style={{ gap: 12 }}>
            {[
              ["Address", state.address],
              ["Vault", `AES-256 · ${state.vault.length} item${state.vault.length === 1 ? "" : "s"}`],
              ["Data folder", state.dataDir],
            ].map(([k, v]) => (
              <div key={k} className="card" style={{ padding: "14px 16px" }}>
                <div className="eyebrow" style={{ fontSize: 10 }}>{k}</div>
                <div className="mono" style={{ fontSize: 12, marginTop: 8, overflowWrap: "anywhere" }}>{v}</div>
              </div>
            ))}
          </div>
          <div className="eyebrow" style={{ margin: "22px 0 10px" }}>What keeps it private</div>
          {[
            ["Only listens on this computer", "Other devices on your network can’t reach it."],
            ["Private link", "Opening GUG-cli needs the link `gug serve` printed — other programs and websites can’t use it."],
            ["Blocks rebinding and cross-site tricks", "Requests must come from localhost and carry GUG-cli’s own header."],
            ["Encrypted keys", "API keys and tokens are encrypted with a key file only your user account can read."],
            ["Sandboxed previews", "Code you vibe-build runs isolated from the app and its data."],
          ].map(([t, d]) => (
            <div key={t} className="row" style={{ alignItems: "flex-start", gap: 12, padding: "8px 0" }}>
              <Icon d={P.shield} size={18} color="#FF2B3A" />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t}</div>
                <div className="muted" style={{ fontSize: 12 }}>{d}</div>
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 18 }}>
            <button type="button" className="btn" onClick={rotate}>
              <Icon d={P.refresh} size={15} />
              New private link
            </button>
            <button type="button" className="btn" onClick={lock}>
              <Icon d={P.lock} size={15} />
              Lock this browser
            </button>
          </div>
        </section>
        <section className="card rise d4" style={{ padding: 22, display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
          <span className="brand tint" style={{ width: 52, height: 52, borderRadius: 16 }}>
            <Icon d={P.shield} size={26} color="#fff" />
          </span>
          <div style={{ flexGrow: 1, minWidth: 240 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Coming later: cloud sync</div>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.55 }}>
              Use GUG-cli on several devices with a passkey, email + password + 2FA, or Continue with Google, GitHub or Discord.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
