// CSV parsing and turning spreadsheets of orders into Ventures entries.
// Pure functions (no DOM) so they're shared with the tests.

/** RFC 4180-ish: quoted fields, doubled quotes, commas/newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

export interface ImportEntry {
  date: string;
  type: "sale" | "cost" | "refund";
  amount: number;
  orders: number;
  note: string;
}

const money = (v: string | undefined) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};
/** Accepts 2026-10-01, 2026-10-01 14:03:00 +0100, 01/10/2026 (UK), 10/01/2026 when dayFirst=false. */
export function toDay(v: string, dayFirst = true): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/);
  if (m) {
    const [d, mo] = dayFirst ? [m[1], m[2]] : [m[2], m[1]];
    return `${m[3]}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

export const isShopify = (header: string[]) => ["Name", "Financial Status", "Total", "Created at"].every((h) => header.includes(h));

/** Shopify "Export orders" CSV → one sale per order, plus refunds. Line-item rows after the first are skipped. */
export function fromShopify(rows: string[][]): ImportEntry[] {
  const [h, ...data] = rows;
  const col = (name: string) => h.indexOf(name);
  const [cName, cStatus, cTotal, cDate, cRefund] = [col("Name"), col("Financial Status"), col("Total"), col("Created at"), col("Refunded Amount")];
  const out: ImportEntry[] = [];
  const seen = new Set<string>();
  for (const r of data) {
    const name = r[cName]?.trim();
    const total = money(r[cTotal]);
    if (!name || seen.has(name) || !r[cTotal]?.trim() || !Number.isFinite(total)) continue;
    seen.add(name);
    const status = (r[cStatus] ?? "").toLowerCase();
    const date = toDay(r[cDate] ?? "");
    if (!date || total <= 0 || /pending|voided|expired|authorized/.test(status)) continue;
    out.push({ date, type: "sale", amount: Math.round(total * 100) / 100, orders: 1, note: `Shopify ${name}` });
    const refunded = cRefund >= 0 ? money(r[cRefund]) : status === "refunded" ? total : 0;
    if (refunded > 0) out.push({ date, type: "refund", amount: Math.round(refunded * 100) / 100, orders: 0, note: `Shopify ${name} refund` });
  }
  return out;
}

/** Any spreadsheet: pick the date and amount columns. Negative amounts become costs. */
export function fromColumns(rows: string[][], opts: { date: number; amount: number; note: number; dayFirst: boolean; skipHeader: boolean }): ImportEntry[] {
  const out: ImportEntry[] = [];
  for (const r of opts.skipHeader ? rows.slice(1) : rows) {
    const date = toDay(r[opts.date] ?? "", opts.dayFirst);
    const amount = money(r[opts.amount]);
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    out.push({ date, type: amount < 0 ? "cost" : "sale", amount: Math.round(Math.abs(amount) * 100) / 100, orders: amount < 0 ? 0 : 1, note: opts.note >= 0 ? (r[opts.note] ?? "").trim().slice(0, 120) : "Imported" });
  }
  return out;
}
