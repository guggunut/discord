import assert from "node:assert/strict";
import { test } from "node:test";
import { fromColumns, fromShopify, isShopify, parseCsv, toDay } from "../web/src/csv.ts";

test("CSV parsing handles quotes, commas and newlines inside fields", () => {
  const rows = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""","multi\nline"\n\n1,2,3');
  assert.deepEqual(rows, [["a", "b", "c"], ["x, y", 'say "hi"', "multi\nline"], ["1", "2", "3"]]);
});

test("dates in common formats", () => {
  assert.equal(toDay("2026-10-01 14:03:00 +0100"), "2026-10-01");
  assert.equal(toDay("01/10/2026"), "2026-10-01");
  assert.equal(toDay("10/01/2026", false), "2026-10-01");
  assert.equal(toDay("yesterday"), null);
});

test("Shopify order exports become one sale per order plus refunds", () => {
  const csv = `Name,Email,Financial Status,Paid at,Total,Refunded Amount,Created at,Lineitem name
#1042,a@x.com,paid,2026-09-30,34.99,0,2026-09-30 10:00:00 +0100,Lamp
#1042,,,,,,,Cable clip
#1041,b@x.com,refunded,2026-09-29,18.40,18.40,2026-09-29 09:00:00 +0100,Light bar
#1040,c@x.com,pending,,12.00,,2026-09-28 09:00:00 +0100,Lamp
#1039,d@x.com,partially_refunded,2026-09-27,60.00,10.00,2026-09-27 09:00:00 +0100,Two lamps`;
  const rows = parseCsv(csv);
  assert.ok(isShopify(rows[0]));
  const e = fromShopify(rows);
  assert.deepEqual(e.map((x) => [x.note, x.type, x.amount]), [
    ["Shopify #1042", "sale", 34.99],
    ["Shopify #1041", "sale", 18.4],
    ["Shopify #1041 refund", "refund", 18.4],
    ["Shopify #1039", "sale", 60],
    ["Shopify #1039 refund", "refund", 10],
  ]);
});

test("any spreadsheet with a date and amount column works; negatives are costs", () => {
  const rows = parseCsv("When,What,£\n01/10/2026,Lamp sale,34.99\n02/10/2026,TikTok ads,-12.50\nbad,row,x");
  assert.deepEqual(fromColumns(rows, { date: 0, amount: 2, note: 1, dayFirst: true, skipHeader: true }), [
    { date: "2026-10-01", type: "sale", amount: 34.99, orders: 1, note: "Lamp sale" },
    { date: "2026-10-02", type: "cost", amount: 12.5, orders: 0, note: "TikTok ads" },
  ]);
});
