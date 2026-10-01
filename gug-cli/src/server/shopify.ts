// Shopify → Ventures: pull orders from a store's Admin API into an income
// stream. Uses a custom-app Admin API token (read_orders), stored encrypted.
// Orders already imported are skipped, so syncing is safe to repeat.
import { HttpError, vaultGet, vaultSet } from "./local.js";
import type { Store } from "./store.js";
import { validateEntry, type Entry } from "./ventures.js";

const VERSION = process.env.GUG_SHOPIFY_API_VERSION ?? "2026-01";
const secretName = (streamId: string) => `shopify:${streamId.slice(0, 8)}`;

/** "lumen-desk" | "lumen-desk.myshopify.com" | "https://lumen-desk.myshopify.com/admin" → "lumen-desk.myshopify.com" */
export function normaliseShop(input: unknown): string {
  const raw = String(input ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  const handle = raw.replace(/\.myshopify\.com$/, "");
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(handle)) throw new HttpError(400, "Use your store's myshopify.com address, like lumen-desk.myshopify.com.");
  return `${handle}.myshopify.com`;
}

const base = (shop: string) => process.env.GUG_SHOPIFY_URL ?? `https://${shop}`;

async function call(shop: string, token: string, path: string) {
  const r = await fetch(`${base(shop)}/admin/api/${VERSION}${path}`, { headers: { "X-Shopify-Access-Token": token, accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (r.status === 401 || r.status === 403) throw new HttpError(400, "Shopify rejected the token — it needs the read_orders scope.");
  if (r.status === 404) throw new HttpError(400, "Shopify couldn't find that store.");
  if (!r.ok) throw new HttpError(502, `Shopify said ${r.status}.`);
  return { json: (await r.json()) as any, link: r.headers.get("link") ?? "" };
}

export interface ShopifyOrder {
  name: string;
  created_at: string;
  total_price: string;
  financial_status?: string;
  cancelled_at?: string | null;
  refunds?: { transactions?: { amount: string; kind?: string; status?: string }[] }[];
}

/** One sale per paid order plus one refund for any refunded money. */
export function ordersToEntries(orders: ShopifyOrder[]): Omit<Entry, "id" | "streamId">[] {
  const out: Omit<Entry, "id" | "streamId">[] = [];
  for (const o of orders) {
    const total = Number(o.total_price);
    const status = (o.financial_status ?? "").toLowerCase();
    if (!o.name || !(total > 0) || /pending|voided|expired|authorized/.test(status)) continue;
    const date = String(o.created_at).slice(0, 10);
    out.push({ date, type: "sale", amount: Math.round(total * 100) / 100, orders: 1, note: `Shopify ${o.name}` });
    const refunded = (o.refunds ?? []).flatMap((r) => r.transactions ?? []).filter((t) => (t.kind ?? "refund") === "refund" && (t.status ?? "success") === "success").reduce((a, t) => a + (Number(t.amount) || 0), 0);
    if (refunded > 0) out.push({ date, type: "refund", amount: Math.round(refunded * 100) / 100, orders: 0, note: `Shopify ${o.name} refund` });
  }
  return out;
}

export async function connectShopify(store: Store, streamId: string, shopInput: unknown, token: unknown) {
  const st = store.data.ventures.streams.find((s) => s.id === streamId);
  if (!st) throw new HttpError(404, "Stream not found.");
  const shop = normaliseShop(shopInput);
  const t = String(token ?? "").trim();
  if (!/^shpat_[\w-]{10,}$/.test(t)) throw new HttpError(400, "Paste the Admin API access token — it starts with shpat_.");
  const { json } = await call(shop, t, "/shop.json");
  vaultSet(store, secretName(st.id), JSON.stringify({ shop, token: t }));
  st.shop = shop;
  store.save();
  return { shop, name: String(json?.shop?.name ?? shop) };
}

export function disconnectShopify(store: Store, streamId: string) {
  const st = store.data.ventures.streams.find((s) => s.id === streamId);
  if (!st) throw new HttpError(404, "Stream not found.");
  delete store.data.secrets[secretName(st.id)];
  st.shop = undefined;
  store.save();
}

/** Pulls the last `days` of orders (up to 2,500) and adds the new ones. */
export async function syncShopify(store: Store, streamId: string, days = 90) {
  const v = store.data.ventures;
  const st = v.streams.find((s) => s.id === streamId);
  if (!st?.shop) throw new HttpError(400, "Connect this stream to Shopify first.");
  const cred = JSON.parse(vaultGet(store, secretName(st.id)) ?? "null") as { shop: string; token: string } | null;
  if (!cred) throw new HttpError(400, "The Shopify token is missing — connect again.");
  const since = new Date(Date.now() - days * 864e5).toISOString();
  let path = `/orders.json?status=any&limit=250&created_at_min=${encodeURIComponent(since)}&fields=name,created_at,total_price,financial_status,cancelled_at,refunds`;
  const orders: ShopifyOrder[] = [];
  for (let page = 0; page < 10 && path; page++) {
    const { json, link } = await call(cred.shop, cred.token, path);
    orders.push(...(json?.orders ?? []));
    // Cursor pagination: Link: <https://…/orders.json?page_info=…>; rel="next"
    const next = link.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    path = next ? next.slice(next.indexOf("/orders.json")) : "";
  }
  const have = new Set(v.entries.filter((e) => e.streamId === st.id && /^Shopify #/.test(e.note)).map((e) => `${e.type}|${e.note}`));
  let added = 0;
  for (const e of ordersToEntries(orders)) {
    if (have.has(`${e.type}|${e.note}`)) continue;
    v.entries.push(validateEntry(v, { ...e, streamId: st.id }));
    have.add(`${e.type}|${e.note}`);
    added++;
  }
  st.syncedAt = new Date().toISOString();
  store.save();
  return { orders: orders.length, added, syncedAt: st.syncedAt };
}
