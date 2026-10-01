// `gug today`, `gug money`, `gug log`, `gug price`, `gug watch`, `gug flows`, `gug backup`.
// Reads come straight from the local database. Changes go through the running
// app when it's up (so its in-memory copy stays in sync) and to the database
// file directly when it isn't.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { makeBackup } from "./server/backup.js";
import { config, paths } from "./server/config.js";
import type { GugEvent } from "./server/events.js";
import { runFlow } from "./server/flows.js";
import { parseSymbol, quote, stats, type Span } from "./server/markets.js";
import { Store } from "./server/store.js";
import { briefing } from "./server/today.js";
import { summarise, validateEntry, type Range } from "./server/ventures.js";

const RED = "\x1b[31m", DIM = "\x1b[2m", BOLD = "\x1b[1m", RESET = "\x1b[0m";
const tty = process.stdout.isTTY;
const c = (code: string, s: string) => (tty ? code + s + RESET : s);
const up = (n: number | null) => (n === null ? c(DIM, "new") : n >= 0 ? `▲ ${n}%` : c(RED, `▼ ${Math.abs(n)}%`));
const money = (n: number, cur: string) => {
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: cur, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${cur}`;
  }
};
const fail = (msg: string) => (console.error(`  ${c(RED, "✖")} ${msg}`), 1);

type Api = (method: string, path: string, body?: unknown) => Promise<any>;

/** Returns a client for the running app, or null if it isn't running. */
async function runningApp(): Promise<Api | null> {
  const base = `http://127.0.0.1:${config.port}`;
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(800) });
    if (!r.ok || !existsSync(paths.token())) return null;
  } catch {
    return null;
  }
  const token = readFileSync(paths.token(), "utf8").trim();
  return async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { cookie: `gug_local=${token}`, "x-gug-request": "1", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const ct = r.headers.get("content-type") ?? "";
    if (ct.includes("text/event-stream")) return r;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? `App said ${r.status}`);
    return j;
  };
}

/** Streams a server-sent-events response as GugEvents. */
async function* sseEvents(res: Response): AsyncGenerator<GugEvent> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6));
    }
  }
}

export async function dataCommand(cmd: string, args: string[], flags: Record<string, string | boolean>): Promise<number | null> {
  const store = () => new Store(paths.db());
  switch (cmd) {
    case "today": {
      const t = await briefing(store());
      console.log(`\n  ${c(BOLD, new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}\n`);
      if (t.inbox.unread) console.log(`  ${c(RED, "●")} ${t.inbox.unread} new in your inbox ${c(DIM, `— ${t.inbox.latest[0]?.title ?? ""}`)}`);
      for (const p of t.posts) console.log(`  ${c(RED, "◆")} ${p.time} ${p.title} ${c(DIM, `${p.platform} · ${p.status}`)}`);
      if (t.money) console.log(`  ${c(RED, "£")} Profit today ${c(BOLD, money(t.money.today, t.money.currency))} ${c(DIM, `· this week ${money(t.money.week, t.money.currency)}`)} ${up(t.money.weekChange)}`);
      for (const m of t.movers) console.log(`  ${m.changePct >= 0 ? "▲" : c(RED, "▼")} ${c(BOLD, m.label)} ${m.price} ${m.currency} ${c(DIM, `${m.changePct >= 0 ? "+" : ""}${m.changePct}% today`)}`);
      if (t.nextFlow) console.log(`  ${c(RED, "↻")} Next automation: ${t.nextFlow.name} ${c(DIM, new Date(t.nextFlow.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }))}`);
      if (!t.inbox.unread && !t.posts.length && !t.money && !t.movers.length && !t.nextFlow) console.log(c(DIM, "  Quiet day. Add income streams, a watchlist or flows in the app."));
      console.log();
      return 0;
    }
    case "money": {
      const range = (["7d", "30d", "90d", "12m"].includes(String(flags.range)) ? flags.range : "30d") as Range;
      const s = summarise(store().data.ventures, range);
      if (!s.streams.length) return console.log(c(DIM, "\n  No income streams yet — add one in Ventures.\n")), 0;
      const k = s.kpis;
      console.log(`\n  ${c(BOLD, "Ventures")} ${c(DIM, `${s.from} → ${s.to}`)}\n`);
      console.log(`  Revenue   ${c(BOLD, money(k.revenue.value, s.currency).padEnd(14))} ${up(k.revenue.change)}`);
      console.log(`  Profit    ${c(BOLD, money(k.profit.value, s.currency).padEnd(14))} ${up(k.profit.change)}`);
      console.log(`  Orders    ${c(BOLD, String(k.orders.value).padEnd(14))} ${up(k.orders.change)}`);
      console.log(`  Margin    ${c(BOLD, `${k.margin.value}%`.padEnd(14))}\n`);
      for (const x of s.streams) console.log(`  ${c(RED, "●")} ${x.name.padEnd(22)} ${money(x.totals.profit, s.currency).padStart(12)} ${c(DIM, `${x.margin}% margin`)} ${up(x.change)}`);
      console.log();
      return 0;
    }
    case "log": {
      // gug log sale 34.99 --stream "Lumen Desk Co." [--orders 1] [--note "…"] [--date 2026-10-01]
      const [type, amount] = args;
      if (!["sale", "cost", "refund"].includes(type) || !amount) return fail('Use: gug log sale|cost|refund <amount> --stream "Name" [--note "…"]');
      const s = store();
      const name = String(flags.stream ?? "").toLowerCase();
      const st = s.data.ventures.streams.find((x) => x.name.toLowerCase() === name) ?? (s.data.ventures.streams.length === 1 && !name ? s.data.ventures.streams[0] : undefined);
      if (!st) return fail(`Pick a stream with --stream. You have: ${s.data.ventures.streams.map((x) => `"${x.name}"`).join(", ") || "none yet"}.`);
      const d = new Date();
      const body = { streamId: st.id, type, amount: Number(amount), orders: flags.orders ? Number(flags.orders) : 1, note: typeof flags.note === "string" ? flags.note : "", date: typeof flags.date === "string" ? flags.date : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` };
      try {
        const app = await runningApp();
        if (app) await app("POST", "/api/ventures/entries", body);
        else {
          s.data.ventures.entries.push(validateEntry(s.data.ventures, body));
          s.flush();
        }
      } catch (e) {
        return fail((e as Error).message);
      }
      console.log(`  ${c(RED, "✔")} Logged ${type} of ${amount}${st.robux ? " R$" : ""} to ${st.name.replace(/\.$/, "")}.`);
      return 0;
    }
    case "price": {
      if (!args[0]) return fail("Use: gug price AAPL  (or BTC, VUSA.L, ^GSPC)");
      const span = (["1d", "1w", "1m", "6m", "1y"].includes(String(flags.span)) ? flags.span : "1m") as Span;
      try {
        const q = await quote(parseSymbol(args[0]), span);
        const st = stats(q.history);
        console.log(`\n  ${c(BOLD, q.label)} ${c(DIM, q.name)}`);
        console.log(`  ${c(BOLD, `${q.price} ${q.currency}`)}  ${q.changePct >= 0 ? "▲" : c(RED, "▼")} ${q.changePct}% today${q.stale ? c(RED, "  (stale)") : ""}`);
        console.log(c(DIM, `  ${span}: ${st.changePct >= 0 ? "+" : ""}${st.changePct}% · high ${st.high} · low ${st.low} · max drawdown ${st.maxDrawdownPct}%`));
        console.log(c(DIM, "  Public price feed, may be delayed. Not financial advice.\n"));
        return 0;
      } catch (e) {
        return fail((e as Error).message);
      }
    }
    case "watch": {
      const [sub, sym] = args;
      if (sub === "add" || sub === "rm") {
        if (!sym) return fail(`Use: gug watch ${sub} AAPL`);
        try {
          const w = parseSymbol(sym);
          const app = await runningApp();
          if (app) {
            if (sub === "add") await app("POST", "/api/markets/watch", { symbol: sym });
            else await app("DELETE", `/api/markets/watch/${w.kind}/${encodeURIComponent(w.symbol)}`);
          } else {
            const s = store();
            if (sub === "add") {
              if (s.data.markets.watch.some((x) => x.symbol === w.symbol && x.kind === w.kind)) return fail(`${w.label} is already on your list.`);
              await quote(w, "1m");
              s.data.markets.watch.push({ ...w, addedAt: new Date().toISOString() });
            } else s.data.markets.watch = s.data.markets.watch.filter((x) => !(x.symbol === w.symbol && x.kind === w.kind));
            s.flush();
          }
          console.log(`  ${c(RED, "✔")} ${sub === "add" ? "Watching" : "Removed"} ${w.label}.`);
          return 0;
        } catch (e) {
          return fail((e as Error).message);
        }
      }
      const watch = store().data.markets.watch;
      if (!watch.length) return console.log(c(DIM, "\n  Your watchlist is empty. Try: gug watch add AAPL\n")), 0;
      console.log();
      const rows = await Promise.all(watch.map(async (w) => ({ w, q: await quote(w, "1d").catch(() => null) })));
      for (const { w, q } of rows) console.log(`  ${c(BOLD, w.label.padEnd(10))} ${q ? `${String(q.price).padStart(12)} ${q.currency.padEnd(4)} ${q.changePct >= 0 ? "▲" : c(RED, "▼")} ${Math.abs(q.changePct)}%` : c(DIM, "no price right now")}${w.alert ? c(DIM, `  alert ${w.alert.above ? `≥ ${w.alert.above}` : ""} ${w.alert.below ? `≤ ${w.alert.below}` : ""}`) : ""}`);
      console.log();
      return 0;
    }
    case "flows": {
      const s = store();
      if (args[0] === "run") {
        const name = args.slice(1).join(" ").toLowerCase();
        const f = s.data.flows.find((x) => x.name.toLowerCase() === name) ?? s.data.flows.find((x) => x.name.toLowerCase().includes(name));
        if (!name || !f) return fail(`Use: gug flows run "<name>". You have: ${s.data.flows.map((x) => `"${x.name}"`).join(", ") || "no flows yet"}.`);
        const app = await runningApp();
        const events: AsyncGenerator<GugEvent & { step?: number }> = app ? sseEvents(await app("POST", `/api/flows/${f.id}/run`, {})) : runFlow(s, f, "manual");
        let step = -1;
        let failed = 0;
        for await (const ev of events) {
          if (ev.type === "start" && ev.step !== step) {
            step = ev.step ?? 0;
            process.stdout.write(`\n${c(RED, "●")} ${c(BOLD, `Step ${step + 1}`)} ${c(DIM, `${ev.agent ?? ""} · ${ev.model ?? ""}`)}\n`);
          }
          if (ev.type === "text") process.stdout.write(ev.text);
          if (ev.type === "tool") process.stderr.write(`\n${c(RED, "▸")} ${ev.name} ${c(DIM, ev.detail)}`);
          if (ev.type === "error") {
            failed = 1;
            process.stderr.write(`\n${c(RED, "✖")} ${ev.message}\n`);
          }
        }
        if (!app) s.flush();
        process.stdout.write("\n");
        return failed;
      }
      if (!s.data.flows.length) return console.log(c(DIM, "\n  No flows yet — create one in the app's Flows screen.\n")), 0;
      console.log();
      for (const f of s.data.flows) {
        const when = f.trigger.type === "daily" ? `daily ${f.trigger.at}` : f.trigger.type === "every" ? `every ${f.trigger.minutes} min` : "manual";
        console.log(`  ${f.enabled ? c(RED, "●") : c(DIM, "○")} ${c(BOLD, f.name.padEnd(26))} ${c(DIM, when.padEnd(16))} ${c(DIM, f.lastRunAt ? `last ${new Date(f.lastRunAt).toLocaleString("en-GB")}` : "never run")}`);
      }
      console.log(c(DIM, `\n  Run one now: gug flows run "${s.data.flows[0].name}"\n`));
      return 0;
    }
    case "backup": {
      const out = typeof flags.out === "string" ? flags.out : `gug-cli-backup-${new Date().toISOString().slice(0, 10)}.json`;
      writeFileSync(out, JSON.stringify(makeBackup(store(), { chats: !!flags.chats }), null, 2), { mode: 0o600 });
      console.log(`  ${c(RED, "✔")} Backup written to ${out} ${c(DIM, "(no API keys inside)")}`);
      return 0;
    }
  }
  return null;
}
