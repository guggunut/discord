// Live stats for a Roblox experience from Roblox's public web APIs (no key):
// players online, visits, favourites and votes. A daily snapshot is kept so
// Ventures can chart growth.
import { HttpError } from "./local.js";
import type { Store } from "./store.js";

export interface RobloxStats {
  universeId: number;
  name: string;
  playing: number;
  visits: number;
  favorites: number;
  upVotes: number;
  downVotes: number;
  updated?: string;
  at: string;
}
export interface RobloxSnapshot {
  day: string;
  visits: number;
  playing: number;
  favorites: number;
}

const APIS = () => process.env.GUG_ROBLOX_APIS_URL ?? "https://apis.roblox.com";
const GAMES = () => process.env.GUG_ROBLOX_GAMES_URL ?? "https://games.roblox.com";
const cache = new Map<number, { at: number; s: RobloxStats }>();

async function json(url: string) {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (r.status === 429) throw new HttpError(429, "Roblox is rate-limiting — try again in a minute.");
  if (!r.ok) throw new HttpError(r.status === 404 || r.status === 400 ? 404 : 502, r.status === 404 || r.status === 400 ? "Roblox doesn't know that place ID." : `Roblox said ${r.status}.`);
  return r.json() as Promise<any>;
}

/** Accepts a place ID or a roblox.com/games/<id>/… link. */
export function parsePlaceId(input: unknown): number {
  const m = String(input ?? "").match(/(?:games\/)?(\d{3,15})/);
  const id = m ? Number(m[1]) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, "Paste your game's link or place ID (the number in roblox.com/games/…).");
  return id;
}

export async function universeFor(placeId: number): Promise<number> {
  const j = await json(`${APIS()}/universes/v1/places/${placeId}/universe`);
  const id = Number(j?.universeId);
  if (!id) throw new HttpError(404, "Roblox doesn't know that place ID.");
  return id;
}

export async function robloxStats(universeId: number): Promise<RobloxStats> {
  const hit = cache.get(universeId);
  if (hit && Date.now() - hit.at < 60_000) return hit.s;
  const [games, votes] = await Promise.all([json(`${GAMES()}/v1/games?universeIds=${universeId}`), json(`${GAMES()}/v1/games/votes?universeIds=${universeId}`).catch(() => ({ data: [] }))]);
  const g = games?.data?.[0];
  if (!g) throw new HttpError(404, "Couldn't find that experience.");
  const v = votes?.data?.[0] ?? {};
  const s: RobloxStats = {
    universeId,
    name: String(g.name ?? "Your game").slice(0, 80),
    playing: Number(g.playing) || 0,
    visits: Number(g.visits) || 0,
    favorites: Number(g.favoritedCount) || 0,
    upVotes: Number(v.upVotes) || 0,
    downVotes: Number(v.downVotes) || 0,
    updated: typeof g.updated === "string" ? g.updated : undefined,
    at: new Date().toISOString(),
  };
  cache.set(universeId, { at: Date.now(), s });
  return s;
}

/** Keeps one snapshot per stream per day (the latest of the day wins). */
export function recordSnapshot(store: Store, streamId: string, s: RobloxStats) {
  const day = s.at.slice(0, 10);
  const list = (store.data.robloxHistory[streamId] ??= []);
  const snap = { day, visits: s.visits, playing: s.playing, favorites: s.favorites };
  if (list.at(-1)?.day === day) list[list.length - 1] = snap;
  else list.push(snap);
  if (list.length > 400) list.splice(0, list.length - 400);
  store.save();
}
