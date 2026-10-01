// The daily briefing shown in the Command center and by `gug today`.
import { quote } from "./markets.js";
import type { Store } from "./store.js";
import { summarise } from "./ventures.js";
import { focusStats } from "./focus.js";

export async function briefing(store: Store) {
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const v = summarise(store.data.ventures, "7d", now);
  const todayProfit = v.series.at(-1)?.profit ?? 0;
  const withTimeout = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  const movers = (
    await Promise.all(
      store.data.markets.watch.slice(0, 12).map((w) =>
        withTimeout(
          quote(w, "1d").catch(() => null),
          2500,
        ),
      ),
    )
  )
    .filter((q): q is NonNullable<typeof q> => !!q)
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 3)
    .map((q) => ({ label: q.label, price: q.price, currency: q.currency, changePct: q.changePct }));
  const nextFlow = store.data.flows
    .filter((f) => f.enabled && f.trigger.type !== "manual")
    .map((f) => {
      let at: number;
      if (f.trigger.type === "daily" || f.trigger.type === "weekly") {
        const [h, m] = f.trigger.at.split(":").map(Number);
        const t = new Date(now);
        t.setHours(h, m, 0, 0);
        const step = f.trigger.type === "weekly" ? 7 : 1;
        if (f.trigger.type === "weekly") t.setDate(t.getDate() + ((f.trigger.day - t.getDay() + 7) % 7));
        if (t <= now || (f.lastRunAt && new Date(f.lastRunAt) >= t)) t.setDate(t.getDate() + step);
        at = t.getTime();
      } else at = (f.lastRunAt ? Date.parse(f.lastRunAt) : Date.parse(f.createdAt)) + (f.trigger.type === "every" ? f.trigger.minutes : 0) * 60_000;
      return { name: f.name, at: new Date(Math.max(at, now.getTime())).toISOString() };
    })
    .sort((a, b) => a.at.localeCompare(b.at))[0];
  return {
    inbox: { unread: store.data.inbox.filter((i) => !i.read).length, latest: store.data.inbox.slice(0, 3).map(({ id, title, at, read }) => ({ id, title, at, read })) },
    posts: store.data.growth.posts.filter((p) => p.date === day).sort((a, b) => a.time.localeCompare(b.time)).map(({ id, time, platform, title, status }) => ({ id, time, platform, title, status })),
    money: v.streams.length ? { currency: v.currency, today: todayProfit, week: v.kpis.profit.value, weekChange: v.kpis.profit.change } : null,
    movers,
    nextFlow: nextFlow ?? null,
    focus: focusStats(store),
  };
}
