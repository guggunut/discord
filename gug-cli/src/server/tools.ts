// Tools that let agents read and act on what's in GUG-cli: your money, markets,
// content calendar, automations and inbox. Everything an agent can change is
// small and reversible — entries can be deleted, posts land as drafts, new
// flows start switched off — and every call shows up in the chat.
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { validateFlow } from "./flows.js";
import { addFact } from "./memory.js";
import { focusStats } from "./focus.js";
import { robloxStats } from "./roblox.js";
import { PLATFORMS, validatePost } from "./growth.js";
import { HttpError, vaultList } from "./local.js";
import { parseSymbol, quote, stats, type Span } from "./markets.js";
import type { Store } from "./store.js";
import { summarise, validateEntry, type Range } from "./ventures.js";

export interface AgentTool {
  def: Anthropic.Beta.Messages.BetaTool;
  /** Shown in the chat while the tool runs, e.g. "Checked your money". */
  label: string;
  /** Changes something (always small and reversible). Hidden when the agent is set to read-only. */
  writes?: boolean;
  run: (input: Record<string, unknown>) => Promise<{ text: string; summary: string }>;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Anthropic.Beta.Messages.BetaTool => ({
  name,
  description,
  input_schema: { type: "object", properties, required, additionalProperties: false },
  eager_input_streaming: true,
});

export function toolsFor(store: Store, agentId: string): AgentTool[] {
  const d = store.data;
  const all: Record<string, AgentTool> = {
    money_summary: {
      label: "Read your money",
      def: tool("money_summary", "Get the user's income summary from the Ventures tracker: revenue, profit, orders, margin and per-stream totals, compared with the previous period. Amounts are in the user's home currency.", { range: { type: "string", enum: ["7d", "30d", "90d", "12m"], description: "Period to summarise. Default 30d." } }),
      run: async (i) => {
        const range = (["7d", "30d", "90d", "12m"].includes(i.range as string) ? i.range : "30d") as Range;
        const v = summarise(d.ventures, range);
        if (!v.streams.length) return { text: "The user hasn't added any income streams yet.", summary: "no streams yet" };
        const out = { currency: v.currency, period: `${v.from} to ${v.to}`, kpis: v.kpis, streams: v.streams.map((x) => ({ name: x.name, kind: x.kind, ...x.totals, margin: x.margin, profitChangePct: x.change })) };
        return { text: JSON.stringify(out), summary: `${range} · ${v.streams.length} streams` };
      },
    },
    log_money: {
      writes: true,
      label: "Logged money",
      def: tool("log_money", "Record a sale, cost or refund in the user's Ventures tracker. Only use when the user clearly asks you to log something. Robux streams take amounts in R$.", {
        stream: { type: "string", description: "Name of an existing income stream (case-insensitive)." },
        type: { type: "string", enum: ["sale", "cost", "refund"] },
        amount: { type: "number", description: "Positive amount in the stream's unit." },
        orders: { type: "integer", description: "Number of orders, for sales. Default 1." },
        date: { type: "string", description: "YYYY-MM-DD. Default today." },
        note: { type: "string" },
      }, ["stream", "type", "amount"]),
      run: async (i) => {
        const name = s(i.stream, 60).toLowerCase();
        const st = d.ventures.streams.find((x) => x.name.toLowerCase() === name) ?? d.ventures.streams.find((x) => x.name.toLowerCase().includes(name));
        if (!st) throw new HttpError(400, `No stream called "${i.stream}". Streams: ${d.ventures.streams.map((x) => x.name).join(", ") || "none yet"}.`);
        const e = validateEntry(d.ventures, { streamId: st.id, type: i.type, amount: i.amount, orders: i.orders ?? 1, date: s(i.date, 10) || today(), note: s(i.note, 120) });
        d.ventures.entries.push(e);
        store.save();
        return { text: `Logged ${e.type} of ${e.amount}${st.robux ? " R$" : ""} to ${st.name} on ${e.date}.`, summary: `${e.type} ${e.amount}${st.robux ? " R$" : ""} → ${st.name}` };
      },
    },
    market_quote: {
      label: "Checked a price",
      def: tool("market_quote", "Get a live (possibly delayed) price and range statistics for a stock, fund or coin. Use tickers like AAPL, VUSA.L, ^GSPC or coins like BTC, ETH.", {
        symbol: { type: "string" },
        span: { type: "string", enum: ["1d", "1w", "1m", "6m", "1y"], description: "Default 1m." },
      }, ["symbol"]),
      run: async (i) => {
        const span = (["1d", "1w", "1m", "6m", "1y"].includes(i.span as string) ? i.span : "1m") as Span;
        const q = await quote(parseSymbol(s(i.symbol, 30)), span);
        const st = stats(q.history);
        return { text: JSON.stringify({ name: q.name, symbol: q.label, currency: q.currency, price: q.price, todayChangePct: q.changePct, span, ...st, stale: !!q.stale }), summary: `${q.label} ${q.price} ${q.currency}` };
      },
    },
    watchlist: {
      label: "Read your watchlist",
      def: tool("watchlist", "List the user's market watchlist with alerts, and their paper-trading account (practice money only).", {}),
      run: async () => {
        const m = d.markets;
        return { text: JSON.stringify({ watch: m.watch.map((w) => ({ symbol: w.label, kind: w.kind, alert: w.alert })), paper: { cash: m.paper.cash, start: m.paper.start, positions: m.paper.positions } }), summary: `${m.watch.length} on the list` };
      },
    },
    add_to_watchlist: {
      writes: true,
      label: "Added to watchlist",
      def: tool("add_to_watchlist", "Add a stock, fund or coin to the user's watchlist. Only when the user asks.", { symbol: { type: "string" } }, ["symbol"]),
      run: async (i) => {
        const w = parseSymbol(s(i.symbol, 30));
        if (d.markets.watch.some((x) => x.symbol === w.symbol && x.kind === w.kind)) return { text: `${w.label} is already on the watchlist.`, summary: `${w.label} already there` };
        if (d.markets.watch.length >= 30) throw new HttpError(400, "The watchlist is full.");
        await quote(w, "1m");
        d.markets.watch.push({ ...w, addedAt: new Date().toISOString() });
        store.save();
        return { text: `Added ${w.label}.`, summary: w.label };
      },
    },
    list_posts: {
      label: "Read your calendar",
      def: tool("list_posts", "List the user's planned and published social posts between two dates.", { from: { type: "string", description: "YYYY-MM-DD, default today" }, to: { type: "string", description: "YYYY-MM-DD, default 7 days after from" } }),
      run: async (i) => {
        const from = /^\d{4}-\d{2}-\d{2}$/.test(s(i.from)) ? s(i.from) : today();
        const to = /^\d{4}-\d{2}-\d{2}$/.test(s(i.to)) ? s(i.to) : new Date(Date.parse(from) + 7 * 864e5).toISOString().slice(0, 10);
        const posts = d.growth.posts.filter((p) => p.date >= from && p.date <= to).map(({ date, time, platform, title, status, caption, metrics }) => ({ date, time, platform, title, status, caption: caption.slice(0, 300), metrics }));
        return { text: JSON.stringify(posts), summary: `${posts.length} posts ${from} → ${to}` };
      },
    },
    add_post: {
      writes: true,
      label: "Drafted a post",
      def: tool("add_post", "Add a draft post to the user's content calendar. It stays a draft until the user approves it.", {
        date: { type: "string", description: "YYYY-MM-DD" },
        time: { type: "string", description: "HH:MM, 24h. Default 19:00" },
        platform: { type: "string", enum: PLATFORMS },
        title: { type: "string" },
        caption: { type: "string" },
      }, ["date", "platform", "title"]),
      run: async (i) => {
        const p = validatePost({ ...i, time: s(i.time, 5) || "19:00", status: "draft" });
        d.growth.posts.push(p);
        store.save();
        return { text: `Added draft "${p.title}" for ${p.platform} on ${p.date} at ${p.time}.`, summary: `${p.platform} · ${p.date} · ${p.title}` };
      },
    },
    list_flows: {
      label: "Read your automations",
      def: tool("list_flows", "List the user's automations (flows) with their schedules and last results.", {}),
      run: async () => ({ text: JSON.stringify(d.flows.map((f) => ({ name: f.name, enabled: f.enabled, trigger: f.trigger, steps: f.steps, lastRunAt: f.lastRunAt, lastOk: f.runs[0]?.ok }))), summary: `${d.flows.length} flows` }),
    },
    create_flow: {
      writes: true,
      label: "Set up an automation",
      def: tool("create_flow", "Create an automation that runs agents on a schedule and sends the result to the inbox (and optionally Discord). It is created switched OFF so the user can review it first.", {
        name: { type: "string" },
        trigger: { type: "object", description: '{"type":"daily","at":"08:00"}, {"type":"weekly","day":0,"at":"18:00"} (0 = Sunday), {"type":"every","minutes":60} or {"type":"manual"}' },
        steps: { type: "array", description: "1-5 steps, each {agent, prompt}. Agents: atlas, ledger, quant, muse, echo, relay, scout, forge, vox, tempo, sage, sentinel. Prompts may use {{date}}, {{time}}, {{previous}}.", items: { type: "object" } },
        discord: { type: "boolean", description: "Also post to Discord." },
      }, ["name", "steps"]),
      run: async (i) => {
        if (d.flows.length >= 50) throw new HttpError(400, "Too many flows.");
        const f = validateFlow({ name: i.name, trigger: i.trigger, steps: i.steps, enabled: false, deliver: { inbox: true, discord: !!i.discord } });
        d.flows.push(f);
        store.save();
        return { text: `Created "${f.name}" (switched off — the user can turn it on in Flows).`, summary: `${f.name} (off)` };
      },
    },
    inbox: {
      label: "Read your inbox",
      def: tool("inbox", "Read the latest items in the user's inbox (flow results and price alerts).", {}),
      run: async () => ({ text: JSON.stringify(d.inbox.slice(0, 10).map(({ title, body, at, read }) => ({ title, body: body.slice(0, 600), at, read }))), summary: `${d.inbox.length} items` }),
    },
    leave_note: {
      writes: true,
      label: "Left a note",
      def: tool("leave_note", "Save a note to the user's inbox so they can find it later (a plan, a checklist, a summary). Only when the user asks you to save or remember something.", { title: { type: "string" }, body: { type: "string" } }, ["title", "body"]),
      run: async (i) => {
        const title = s(i.title, 120);
        const body = s(i.body, 6000);
        if (!title || !body) throw new HttpError(400, "A note needs a title and a body.");
        d.inbox = [{ id: randomUUID(), flowId: `agent:${agentId}`, title, body, at: new Date().toISOString(), read: false }, ...d.inbox].slice(0, 100);
        store.save();
        return { text: "Saved to the inbox.", summary: title };
      },
    },
    remember: {
      writes: true,
      label: "Remembered",
      def: tool("remember", "Save a short fact about the user to GUG-cli's shared memory so every agent knows it next time (e.g. 'Sells desk lamps on Shopify', 'Prefers UK spelling'). Only when the user asks you to remember something, or clearly states a lasting preference.", { fact: { type: "string", description: "One short sentence." } }, ["fact"]),
      run: async (i) => {
        const f = addFact(store, s(i.fact, 300), agentId);
        return { text: `Remembered: ${f.text}`, summary: f.text };
      },
    },
    game_stats: {
      label: "Checked your Roblox game",
      def: tool("game_stats", "Get live stats for the user's linked Roblox games: players online now, total visits, favourites, likes/dislikes, and daily visit history (to see growth).", {}),
      run: async () => {
        const linked = d.ventures.streams.filter((x) => x.universeId);
        if (!linked.length) return { text: "No Roblox game is linked yet. The user can link one on a Roblox stream in Ventures.", summary: "no game linked" };
        const out = await Promise.all(linked.map(async (x) => ({ stream: x.name, ...(await robloxStats(x.universeId!).catch((e) => ({ error: String(e?.message ?? e) }))), history: (d.robloxHistory[x.id] ?? []).slice(-14) })));
        return { text: JSON.stringify(out), summary: linked.map((x) => x.name).join(", ") };
      },
    },
    focus_stats: {
      label: "Checked your focus time",
      def: tool("focus_stats", "See how much focused time the user has logged with GUG-cli's focus timer: minutes today, this week, current daily streak and recent sessions.", {}),
      run: async () => {
        const f = focusStats(store);
        return { text: JSON.stringify(f), summary: `${f.today}m today · ${f.streak}-day streak` };
      },
    },
    security_status: {
      label: "Checked your setup",
      def: tool("security_status", "See how GUG-cli is secured on this computer: which connections are stored (names only, never values) and the safety settings.", {}),
      run: async () => ({
        text: JSON.stringify({ storedSecrets: vaultList(store).map((v) => v.name), listensOn: "127.0.0.1 only", accessCookie: "httpOnly, SameSite=Strict", vault: "AES-256-GCM, key file readable only by this user", claudeCodePermission: d.prefs.codePermission }),
        summary: "names only, no values",
      }),
    },
  };
  const by: Record<string, string[]> = {
    atlas: ["focus_stats", "money_summary", "game_stats", "watchlist", "market_quote", "list_posts", "list_flows", "inbox", "leave_note", "remember"],
    ledger: ["money_summary", "game_stats", "log_money", "leave_note", "remember"],
    quant: ["market_quote", "watchlist", "add_to_watchlist", "leave_note", "remember"],
    echo: ["game_stats", "list_posts", "add_post", "leave_note", "remember"],
    muse: ["list_posts", "leave_note", "remember"],
    relay: ["list_flows", "create_flow", "inbox", "leave_note", "remember"],
    tempo: ["focus_stats", "list_posts", "list_flows", "inbox", "leave_note", "remember"],
    scout: ["market_quote", "leave_note", "remember"],
    sage: ["focus_stats", "leave_note", "remember"],
    vox: ["leave_note", "remember"],
    sentinel: ["security_status", "leave_note", "remember"],
    forge: ["leave_note", "remember"],
  };
  const access = d.prefs.agents[agentId]?.autonomy ?? "ask";
  if (access === "off") return [];
  return (by[agentId] ?? []).map((k) => all[k]).filter((t) => access !== "read" || !t.writes);
}

export const TOOL_SYSTEM = `You can use tools to read and update the user's GUG-cli data (money tracker, watchlist, content calendar, automations, inbox). Use them whenever the answer depends on the user's own numbers or plans rather than guessing. Only change things when the user asks. After using tools, answer in plain language.`;
