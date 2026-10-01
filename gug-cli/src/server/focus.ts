// Focus sessions logged by the timer in the top bar.
import type { Store } from "./store.js";

const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function focusStats(store: Store, now = new Date()) {
  const s = store.data.focus;
  const today = dayOf(now);
  const weekAgo = dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6));
  const byDay = new Map<string, number>();
  for (const f of s) {
    const d = dayOf(new Date(f.at));
    byDay.set(d, (byDay.get(d) ?? 0) + f.minutes);
  }
  // Consecutive days with focus, counting back from today (or yesterday if today has none yet).
  let streak = 0;
  const cur = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (byDay.has(today) ? 0 : 1));
  while (byDay.has(dayOf(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return {
    today: byDay.get(today) ?? 0,
    week: [...byDay].filter(([d]) => d >= weekAgo).reduce((a, [, m]) => a + m, 0),
    streak,
    recent: s.slice(-10).reverse(),
  };
}
