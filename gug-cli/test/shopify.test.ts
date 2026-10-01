import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.GUG_DATA = mkdtempSync(path.join(tmpdir(), "gug-shopify-"));
const seenTokens: string[] = [];
const fake = createServer((req, res) => {
  seenTokens.push(String(req.headers["x-shopify-access-token"]));
  res.setHeader("content-type", "application/json");
  if (req.headers["x-shopify-access-token"] !== "shpat_goodtoken123") return (res.statusCode = 401), res.end("{}");
  const u = new URL(req.url!, "http://x");
  if (u.pathname.endsWith("/shop.json")) return res.end(JSON.stringify({ shop: { name: "Lumen Desk Co." } }));
  if (u.pathname.endsWith("/orders.json")) {
    if (u.searchParams.get("page_info") === "p2") return res.end(JSON.stringify({ orders: [{ name: "#1003", created_at: "2026-09-29T10:00:00+01:00", total_price: "18.40", financial_status: "refunded", refunds: [{ transactions: [{ amount: "18.40", kind: "refund", status: "success" }] }] }] }));
    res.setHeader("link", `<https://lumen-desk.myshopify.com/admin/api/2026-01/orders.json?limit=250&page_info=p2>; rel="next"`);
    return res.end(JSON.stringify({ orders: [
      { name: "#1001", created_at: "2026-09-30T10:00:00+01:00", total_price: "34.99", financial_status: "paid", refunds: [] },
      { name: "#1002", created_at: "2026-09-30T11:00:00+01:00", total_price: "12.00", financial_status: "pending", refunds: [] },
    ] }));
  }
  res.statusCode = 404;
  res.end("{}");
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", r));
process.env.GUG_SHOPIFY_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
after(() => fake.close());

const { Store } = await import("../src/server/store.ts");
const { validateStream } = await import("../src/server/ventures.ts");
const { connectShopify, normaliseShop, syncShopify, disconnectShopify } = await import("../src/server/shopify.ts");

test("store addresses are normalised and validated", () => {
  assert.equal(normaliseShop("Lumen-Desk"), "lumen-desk.myshopify.com");
  assert.equal(normaliseShop("https://lumen-desk.myshopify.com/admin/orders"), "lumen-desk.myshopify.com");
  assert.throws(() => normaliseShop("evil.com/../x"), /myshopify/);
});

test("connecting stores the token encrypted and syncing imports each order once", async () => {
  const store = new Store(path.join(process.env.GUG_DATA!, "db.json"));
  const st = validateStream({ name: "Lumen Desk Co.", kind: "shopify" });
  store.data.ventures.streams.push(st);
  await assert.rejects(connectShopify(store, st.id, "lumen-desk", "nope"), /shpat_/);
  await assert.rejects(connectShopify(store, st.id, "lumen-desk", "shpat_wrongtoken99"), /rejected the token/);
  const r = await connectShopify(store, st.id, "lumen-desk", "shpat_goodtoken123");
  assert.equal(r.name, "Lumen Desk Co.");
  assert.ok(!JSON.stringify(store.data).includes("shpat_goodtoken123"), "token is sealed in the vault");

  const first = await syncShopify(store, st.id);
  assert.deepEqual([first.orders, first.added], [3, 3], "paid sale + refunded order's sale and refund; pending skipped");
  const notes = store.data.ventures.entries.map((e) => `${e.type} ${e.note} ${e.amount}`);
  assert.deepEqual(notes, ["sale Shopify #1001 34.99", "sale Shopify #1003 18.4", "refund Shopify #1003 refund 18.4"]);
  const again = await syncShopify(store, st.id);
  assert.equal(again.added, 0, "re-sync adds nothing new");

  disconnectShopify(store, st.id);
  await assert.rejects(syncShopify(store, st.id), /Connect this stream/);
});
