// Growth: a content calendar. Echo plans a week of posts and drafts captions;
// you approve them, publish to Discord directly, or copy them to other apps,
// then log how each post did.
import { randomUUID } from "node:crypto";
import { agentById, systemFor } from "./agents.js";
import { runClaude } from "./engines/claude.js";
import type { GugEvent } from "./events.js";
import { HttpError, claudeKeys, vaultGet } from "./local.js";
import type { Store } from "./store.js";

export type Platform = "instagram" | "tiktok" | "youtube" | "x" | "discord";
export type PostStatus = "idea" | "draft" | "approved" | "posted";
export interface Post {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  platform: Platform;
  title: string;
  caption: string;
  status: PostStatus;
  metrics?: { views: number; likes: number; comments: number; shares: number };
  postedAt?: string;
}
export interface Growth {
  brand: string;
  posts: Post[];
}
export const emptyGrowth = (): Growth => ({ brand: "", posts: [] });

export const PLATFORMS: Platform[] = ["instagram", "tiktok", "youtube", "x", "discord"];
const STATUSES: PostStatus[] = ["idea", "draft", "approved", "posted"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const n = (v: unknown) => Math.max(0, Math.min(1e10, Math.round(Number(v) || 0)));

export function validatePost(input: any, existing?: Post): Post {
  const date = String(input?.date ?? existing?.date ?? "");
  if (!DAY.test(date) || Number.isNaN(Date.parse(date))) throw new HttpError(400, "Use a date like 2026-10-01.");
  const time = String(input?.time ?? existing?.time ?? "19:00");
  if (!HHMM.test(time)) throw new HttpError(400, "Use a time like 19:30.");
  const platform: Platform = PLATFORMS.includes(input?.platform) ? input.platform : existing?.platform ?? "instagram";
  const title = String(input?.title ?? existing?.title ?? "").trim().slice(0, 120);
  if (!title) throw new HttpError(400, "Give the post a short title.");
  const status: PostStatus = STATUSES.includes(input?.status) ? input.status : existing?.status ?? "idea";
  const m = input?.metrics;
  return {
    id: existing?.id ?? randomUUID(),
    date,
    time,
    platform,
    title,
    caption: String(input?.caption ?? existing?.caption ?? "").slice(0, 4000),
    status,
    metrics: m ? { views: n(m.views), likes: n(m.likes), comments: n(m.comments), shares: n(m.shares) } : existing?.metrics,
    postedAt: status === "posted" ? existing?.postedAt ?? new Date().toISOString() : undefined,
  };
}

/** Totals for posts in [from, to], compared with the same-length window before. */
export function growthStats(g: Growth, from: string, to: string) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  const prevFrom = new Date(Date.parse(from) - days * 864e5).toISOString().slice(0, 10);
  const sum = (a: string, b: string) => {
    const t = { posts: 0, views: 0, engagement: 0, likes: 0, comments: 0, shares: 0 };
    for (const p of g.posts) {
      if (p.status !== "posted" || p.date < a || p.date > b) continue;
      t.posts++;
      t.views += p.metrics?.views ?? 0;
      t.likes += p.metrics?.likes ?? 0;
      t.comments += p.metrics?.comments ?? 0;
      t.shares += p.metrics?.shares ?? 0;
    }
    t.engagement = t.likes + t.comments + t.shares;
    return t;
  };
  const now = sum(from, to);
  const before = sum(prevFrom, new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10));
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 1000) / 10 : a ? null : 0);
  const byPlatform = PLATFORMS.map((p) => ({
    platform: p,
    views: g.posts.filter((x) => x.platform === p && x.status === "posted" && x.date >= from && x.date <= to).reduce((a, x) => a + (x.metrics?.views ?? 0), 0),
  }));
  // When posts do best, across everything posted with numbers: weekday × part of day, by average views.
  const part = (t: string) => {
    const h = Number(t.slice(0, 2));
    return h >= 6 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 22 ? "evening" : "late night";
  };
  const slots = new Map<string, { views: number; n: number }>();
  for (const p of g.posts) {
    if (p.status !== "posted" || !p.metrics?.views) continue;
    const key = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(`${p.date}T12:00:00`).getDay()]} ${part(p.time)}`;
    const cur = slots.get(key) ?? { views: 0, n: 0 };
    slots.set(key, { views: cur.views + p.metrics.views, n: cur.n + 1 });
  }
  const bestSlots = [...slots].map(([slot, v]) => ({ slot, avgViews: Math.round(v.views / v.n), posts: v.n })).sort((a, b) => b.avgViews - a.avgViews).slice(0, 3);
  return {
    now,
    bestSlots,
    change: { views: pct(now.views, before.views), engagement: pct(now.engagement, before.engagement), posts: pct(now.posts, before.posts) },
    rate: now.views ? Math.round((now.engagement / now.views) * 1000) / 10 : 0,
    byPlatform,
  };
}

/** Pulls the first JSON array out of a model reply (tolerates code fences and prose). */
export function extractJsonArray(text: string): any[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) throw new HttpError(502, "Echo didn't return a plan. Try again.");
  try {
    const v = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(v)) throw new Error("not an array");
    return v;
  } catch {
    throw new HttpError(502, "Echo's plan came back garbled. Try again.");
  }
}

/** Echo plans `count` posts across the week starting `from`. Adds them as ideas. */
export async function* planWeek(store: Store, from: string, goal: string, platforms: Platform[], count: number, signal?: AbortSignal): AsyncGenerator<GugEvent | { type: "posts"; posts: Post[] }> {
  if (!DAY.test(from)) throw new HttpError(400, "Bad start date.");
  const g = store.data.growth;
  const days = Array.from({ length: 7 }, (_, i) => new Date(Date.parse(from) + i * 864e5).toISOString().slice(0, 10));
  const existing = g.posts.filter((p) => days.includes(p.date)).map((p) => `${p.date} ${p.platform}: ${p.title}`);
  const best = growthStats(g, days[0], days[6]).bestSlots;
  const prompt = `Plan ${count} social posts for the week ${days[0]} to ${days[6]}.
Brand / what I do: ${g.brand || "a small online brand (desk setups, digital products, a Roblox game)"}.
Goal this week: ${goal || "grow reach and drive a few sales"}.
Platforms to use: ${platforms.join(", ")}.
Already planned (don't duplicate): ${existing.length ? existing.join("; ") : "nothing"}.
Spread posts across the week at times when people are online${best.length ? ` — my best slots so far by average views: ${best.map((b) => b.slot).join(", ")}` : " (evenings work well)"}.
Reply with ONLY a JSON array, no prose. Each item: {"date":"YYYY-MM-DD","time":"HH:MM","platform":one of ${JSON.stringify(platforms)},"title":"short working title","caption":"ready-to-post caption with a hook first line and 3-5 hashtags"}`;
  let out = "";
  let failed = false;
  for await (const ev of runClaude({ keys: claudeKeys(store), system: systemFor(agentById("echo")!), messages: [{ role: "user", content: prompt }], mode: "deep", agent: "echo", signal, maxTokens: 6000 })) {
    if (ev.type === "text") {
      out += ev.text;
      const done = (out.match(/"title"/g) ?? []).length;
      yield { type: "tool", name: "Echo", detail: `planning… ${done}/${count} posts` };
      continue;
    }
    if (ev.type === "error") failed = true;
    yield ev;
  }
  if (failed || signal?.aborted) return;
  const added: Post[] = [];
  for (const raw of extractJsonArray(out).slice(0, 21)) {
    try {
      const p = validatePost({ ...raw, platform: platforms.includes(raw?.platform) ? raw.platform : platforms[0], date: days.includes(raw?.date) ? raw.date : days[added.length % 7], status: "draft" });
      added.push(p);
    } catch {
      /* skip malformed items */
    }
  }
  if (!added.length) throw new HttpError(502, "Echo's plan had no usable posts. Try again.");
  g.posts.push(...added);
  store.save();
  yield { type: "posts", posts: added };
}

/** Echo rewrites one post's caption for its platform. */
export async function* draftCaption(store: Store, post: Post, ask: string, signal?: AbortSignal): AsyncGenerator<GugEvent> {
  const limits: Record<Platform, string> = { instagram: "up to 150 words, line breaks, 5 hashtags", tiktok: "under 40 words, punchy, 3 hashtags", youtube: "a title line then a 2-3 sentence description", x: "under 260 characters, at most 1 hashtag", discord: "friendly community announcement, can use **bold**, no hashtags" };
  const prompt = `Write the caption for this ${post.platform} post: "${post.title}".
${post.caption ? `Current draft:\n${post.caption}\n` : ""}${ask ? `Change request: ${ask}\n` : ""}Format: ${limits[post.platform]}. Brand: ${store.data.growth.brand || "small online brand, black/red/white aesthetic"}.
Reply with only the caption text.`;
  yield* runClaude({ keys: claudeKeys(store), system: systemFor(agentById("echo")!), messages: [{ role: "user", content: prompt }], mode: "fast", agent: "echo", signal, maxTokens: 1500 });
}

/** Sends a post to the connected Discord webhook and marks it posted. */
export async function publishToDiscord(store: Store, post: Post): Promise<Post> {
  const hook = vaultGet(store, "discord_webhook");
  if (!hook) throw new HttpError(400, "Connect Discord in Apps first.");
  if (!post.caption.trim()) throw new HttpError(400, "Write a caption first.");
  const res = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: post.caption.slice(0, 2000), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new HttpError(502, `Discord said ${res.status}. Check the webhook in Apps.`);
  post.status = "posted";
  post.postedAt = new Date().toISOString();
  store.save();
  return post;
}
