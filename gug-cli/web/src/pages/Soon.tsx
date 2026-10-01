import { useApp } from "../App";
import { Icon, P, Sigil, type Route } from "../ui";

const INFO: Partial<Record<Route, { agent: string; what: string[]; ask: string }>> = {
  ventures: { agent: "ledger", what: ["Revenue and profit across Shopify, Roblox and digital products", "Margins per product with supplier comparisons", "One-click fixes suggested by Ledger"], ask: "Help me work out the margin on a product I sell for $34.99 that costs $11.40 to land, with $8 of ads per sale." },
  markets: { agent: "quant", what: ["Watchlist with live prices and alerts", "Charts with Quant’s plain-English read", "Paper trading first, always"], ask: "Explain the difference between an index fund and picking single stocks, and what risks to watch." },
  studio: { agent: "muse", what: ["Image, video, music and voice generation", "A render queue and gallery", "Send finished work straight to Echo"], ask: "Write 4 image prompts for a product shot of a desk lamp, black background, red rim light." },
  growth: { agent: "echo", what: ["Reach and engagement across platforms", "A content calendar with approvals", "Campaign results and ad return"], ask: "Give me a week of TikTok post ideas for a desk-setup store, with hooks." },
  flows: { agent: "relay", what: ["Visual flow builder: triggers → agents → actions", "Run logs with router fallbacks", "Templates you can copy"], ask: "Design an automation that alerts me on Discord when a store order has a margin under 25%." },
};

export function Soon({ route }: { route: Route }) {
  const { go } = useApp();
  const i = INFO[route]!;
  const ask = () => {
    localStorage.setItem("gug-agent", i.agent);
    localStorage.setItem("gug-prefill", i.ask);
    go("agents");
  };
  return (
    <div className="g2r" style={{ gridTemplateColumns: "minmax(0,1fr) 380px" }}>
      <section className="card rise d2 stage" style={{ minHeight: 420, padding: 40, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start", gap: 14, placeItems: "start" }}>
        <div className="floor" style={{ height: 220, opacity: 0.6 }} />
        <span className="stat" style={{ position: "relative" }}>
          <i />
          Coming in the next update
        </span>
        <h2 className="disp" style={{ position: "relative", margin: 0, fontSize: 30, fontWeight: 300 }}>
          Designed, being built<span style={{ color: "#FF2B3A" }}>.</span>
        </h2>
        <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
          {i.what.map((w, k) => (
            <div key={w} className="rise row" style={{ fontSize: 14, animationDelay: `${0.4 + k * 0.1}s` }}>
              <Icon d={P.check} size={16} color="#FF2B3A" sw={2.4} />
              {w}
            </div>
          ))}
        </div>
      </section>
      <section className="card hot rise d3" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14, alignSelf: "start" }}>
        <div className="row">
          <Sigil id={i.agent} size={40} />
          <div style={{ fontSize: 15, fontWeight: 600 }}>You can already do this with {i.agent.charAt(0).toUpperCase() + i.agent.slice(1)}</div>
        </div>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>“{i.ask}”</p>
        <button type="button" className="btn btn-red" onClick={ask}>
          Ask now <Icon d={P.arrow} size={14} />
        </button>
      </section>
    </div>
  );
}
