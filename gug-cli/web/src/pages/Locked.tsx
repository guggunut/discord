import { useState } from "react";
import { api } from "../api";
import { play } from "../sfx";
import { Icon, Logo, P } from "../ui";

export function Locked({ onUnlocked }: { onUnlocked: () => void }) {
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [shake, setShake] = useState(0);

  const submit = async () => {
    const t = token.trim().replace(/^.*token=/, "");
    try {
      await api("/api/unlock", { body: { token: t } });
      play("boot");
      onUnlocked();
    } catch (e) {
      play("error");
      setErr(e instanceof Error ? e.message : "That didn’t work.");
      setShake((s) => s + 1);
    }
  };

  return (
    <div className="stage" style={{ minHeight: "100vh", background: "radial-gradient(ellipse at 50% 40%, rgba(255,43,58,0.14), transparent 60%), #030303", padding: 24 }}>
      <div className="floor" style={{ height: 360 }} />
      <div className="card rise" style={{ position: "relative", width: 460, maxWidth: "100%", padding: 30, display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="row" style={{ gap: 12 }}>
          <Logo size={34} />
          <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2 }}>
            <span className="disp" style={{ fontSize: 18, fontWeight: 600, letterSpacing: ".12em" }}>
              GUG
            </span>
            <span className="mono" style={{ fontSize: 13, color: "#FF2B3A" }}>
              -cli
            </span>
          </span>
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Locked</h1>
          <p className="muted" style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.6 }}>
            GUG-cli only opens from your private link, so other programs and websites can’t use it. Run this in your terminal to get it:
          </p>
        </div>
        <div className="mono" style={{ padding: "12px 14px", borderRadius: 12, background: "#050505", border: "1px solid rgba(255,255,255,0.1)", fontSize: 13 }}>
          <span style={{ color: "#FF2B3A" }}>❯</span> gug link
        </div>
        <div key={shake} className={shake ? "shake" : ""} style={{ display: "flex", gap: 10 }}>
          <label className="sr" htmlFor="tok">
            Private link or token
          </label>
          <input id="tok" className="field mono" style={{ flexGrow: 1, fontSize: 12 }} placeholder="…or paste the link here" value={token} onChange={(e) => setToken(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
          <button type="button" className="btn btn-red" data-sfx="none" onClick={submit}>
            <Icon d={P.lock} size={15} />
            Unlock
          </button>
        </div>
        {err && <div className="err-text">{err}</div>}
      </div>
    </div>
  );
}
