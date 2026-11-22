import { lineAmountCents, parseHoursToHundredths, parseMoneyToCents } from "./money.js";
import type { ContingentWorker, InvoiceLine, LedgerTotal, Sow, SupportTier } from "./data/seed.js";

// Vendor cost reconciliation for contingent-worker (CW) invoices:
//   1. split the invoice by vendor × support tier (the report the ops office sends every month)
//   2. tie each vendor's invoice total to what AP approved (the source-of-truth ledger)
//   3. flag lines that explain a difference or break the SOW terms
// Everything is integer cents; a report only says "reconciled" when every check passes.

export type ParsedLine = {
  lineId: string;
  period: string;
  vendor: string;
  sowId: string;
  cwId: string;
  hoursHundredths: number;
  rateCents: number;
  amountCents: number;
};

export type RowError = { row: number; message: string };

export const CSV_COLUMNS = ["line_id", "period", "vendor", "sow_id", "cw_id", "hours", "rate", "amount"] as const;

/** RFC 4180-style CSV: quoted fields, doubled quotes, CRLF or LF, optional BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0]!.trim() === ""));
}

export function parseInvoiceCsv(text: string): { lines: ParsedLine[]; errors: RowError[] } {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) throw new Error(`CSV is missing column(s): ${missing.join(", ")}`);
  const idx = Object.fromEntries(CSV_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof CSV_COLUMNS)[number],
    number
  >;
  const lines: ParsedLine[] = [];
  const errors: RowError[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2; // 1-based, header is row 1
    const get = (c: (typeof CSV_COLUMNS)[number]) => (r[idx[c]] ?? "").trim();
    try {
      const period = get("period");
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error(`bad period ${JSON.stringify(period)}`);
      for (const c of ["line_id", "vendor", "sow_id", "cw_id"] as const) {
        if (!get(c)) throw new Error(`empty ${c}`);
      }
      lines.push({
        lineId: get("line_id"),
        period,
        vendor: get("vendor"),
        sowId: get("sow_id"),
        cwId: get("cw_id"),
        hoursHundredths: parseHoursToHundredths(get("hours")),
        rateCents: parseMoneyToCents(get("rate")),
        amountCents: parseMoneyToCents(get("amount")),
      });
    } catch (e) {
      errors.push({ row: rowNo, message: (e as Error).message });
    }
  });
  return { lines, errors };
}

export function fromSeedLines(lines: InvoiceLine[]): ParsedLine[] {
  return lines.map((l) => ({
    lineId: l.lineId,
    period: l.period,
    vendor: l.vendor,
    sowId: l.sowId,
    cwId: l.cwId,
    hoursHundredths: Math.round(l.hours * 100),
    rateCents: l.rateCents,
    amountCents: l.amountCents,
  }));
}

export type AnomalyKind =
  | "duplicate_line"
  | "rate_above_card"
  | "amount_mismatch"
  | "unknown_sow"
  | "unknown_cw"
  | "cw_not_on_sow"
  | "vendor_mismatch"
  | "over_monthly_cap"
  | "wrong_period"
  | "duplicate_line_id";

export type Anomaly = { kind: AnomalyKind; lineIds: string[]; message: string; impactCents: number };

export type SplitRow = {
  vendor: string;
  tier: SupportTier | "unknown";
  lines: number;
  hours: number;
  amountCents: number;
};

export type VendorCheck = {
  vendor: string;
  invoiceCents: number;
  ledgerCents: number | null;
  diffCents: number | null; // invoice − ledger
  status: "match" | "mismatch" | "no_ledger_total";
};

export type Reconciliation = {
  period: string;
  split: SplitRow[];
  vendors: VendorCheck[];
  anomalies: Anomaly[];
  invoiceTotalCents: number;
  ledgerTotalCents: number;
  reconciled: boolean;
};

export type Reference = { sows: Sow[]; cws: ContingentWorker[]; ledger: LedgerTotal[] };

export function reconcile(period: string, lines: ParsedLine[], ref: Reference): Reconciliation {
  const anomalies: Anomaly[] = [];
  const sowById = new Map(ref.sows.map((s) => [s.id, s]));
  const cwById = new Map(ref.cws.map((c) => [c.id, c]));

  const inPeriod = lines.filter((l) => {
    if (l.period === period) return true;
    anomalies.push({
      kind: "wrong_period",
      lineIds: [l.lineId],
      message: `${l.lineId} is for ${l.period}, not ${period}; left out of the totals`,
      impactCents: 0,
    });
    return false;
  });

  const seenIds = new Map<string, number>();
  for (const l of inPeriod) seenIds.set(l.lineId, (seenIds.get(l.lineId) ?? 0) + 1);
  for (const [id, n] of seenIds) {
    if (n > 1)
      anomalies.push({ kind: "duplicate_line_id", lineIds: [id], message: `line id ${id} appears ${n} times`, impactCents: 0 });
  }

  // Same worker, same hours, same rate, same period: almost always a double-billed line.
  const byFingerprint = new Map<string, ParsedLine[]>();
  for (const l of inPeriod) {
    const key = [l.vendor, l.cwId, l.hoursHundredths, l.rateCents, l.amountCents].join("|");
    byFingerprint.set(key, [...(byFingerprint.get(key) ?? []), l]);
  }
  for (const group of byFingerprint.values()) {
    if (group.length > 1) {
      const extra = group.slice(1).reduce((s, l) => s + l.amountCents, 0);
      anomalies.push({
        kind: "duplicate_line",
        lineIds: group.map((l) => l.lineId),
        message: `${group[0]!.cwId} billed ${group.length}× for the same hours and rate`,
        impactCents: extra,
      });
    }
  }

  for (const l of inPeriod) {
    const expected = lineAmountCents(l.hoursHundredths, l.rateCents);
    if (expected !== l.amountCents) {
      anomalies.push({
        kind: "amount_mismatch",
        lineIds: [l.lineId],
        message: `${l.lineId}: hours × rate is ${expected} cents but the line says ${l.amountCents}`,
        impactCents: l.amountCents - expected,
      });
    }
    const sow = sowById.get(l.sowId);
    if (!sow) {
      anomalies.push({ kind: "unknown_sow", lineIds: [l.lineId], message: `${l.lineId}: no SOW ${l.sowId}`, impactCents: 0 });
      continue;
    }
    if (sow.vendor !== l.vendor) {
      anomalies.push({
        kind: "vendor_mismatch",
        lineIds: [l.lineId],
        message: `${l.lineId}: ${l.sowId} belongs to ${sow.vendor}, line says ${l.vendor}`,
        impactCents: 0,
      });
    }
    if (l.rateCents > sow.rateCardCents) {
      anomalies.push({
        kind: "rate_above_card",
        lineIds: [l.lineId],
        message: `${l.lineId}: billed ${l.rateCents} cents/h, ${l.sowId} rate card is ${sow.rateCardCents}`,
        impactCents: lineAmountCents(l.hoursHundredths, l.rateCents - sow.rateCardCents),
      });
    }
    const cw = cwById.get(l.cwId);
    if (!cw) anomalies.push({ kind: "unknown_cw", lineIds: [l.lineId], message: `${l.lineId}: no worker ${l.cwId}`, impactCents: 0 });
    else if (cw.sowId !== l.sowId)
      anomalies.push({
        kind: "cw_not_on_sow",
        lineIds: [l.lineId],
        message: `${l.lineId}: ${l.cwId} is on ${cw.sowId}, billed to ${l.sowId}`,
        impactCents: 0,
      });
  }

  const perSow = new Map<string, number>();
  for (const l of inPeriod) perSow.set(l.sowId, (perSow.get(l.sowId) ?? 0) + l.amountCents);
  for (const [sowId, total] of perSow) {
    const sow = sowById.get(sowId);
    if (sow && total > sow.monthlyCapCents)
      anomalies.push({
        kind: "over_monthly_cap",
        lineIds: inPeriod.filter((l) => l.sowId === sowId).map((l) => l.lineId),
        message: `${sowId} billed ${total} cents, monthly cap is ${sow.monthlyCapCents}`,
        impactCents: total - sow.monthlyCapCents,
      });
  }

  const splitMap = new Map<string, SplitRow>();
  for (const l of inPeriod) {
    const tier = sowById.get(l.sowId)?.tier ?? "unknown";
    const key = `${l.vendor}|${tier}`;
    const row = splitMap.get(key) ?? { vendor: l.vendor, tier, lines: 0, hours: 0, amountCents: 0 };
    row.lines += 1;
    row.hours = (Math.round(row.hours * 100) + l.hoursHundredths) / 100;
    row.amountCents += l.amountCents;
    splitMap.set(key, row);
  }
  const split = [...splitMap.values()].sort((a, b) => a.vendor.localeCompare(b.vendor) || a.tier.localeCompare(b.tier));

  const vendorsSeen = [...new Set([...inPeriod.map((l) => l.vendor), ...ref.ledger.filter((t) => t.period === period).map((t) => t.vendor)])].sort();
  const vendors: VendorCheck[] = vendorsSeen.map((vendor) => {
    const invoiceCents = inPeriod.filter((l) => l.vendor === vendor).reduce((s, l) => s + l.amountCents, 0);
    const ledger = ref.ledger.find((t) => t.period === period && t.vendor === vendor);
    if (!ledger) return { vendor, invoiceCents, ledgerCents: null, diffCents: null, status: "no_ledger_total" };
    const diffCents = invoiceCents - ledger.amountCents;
    return { vendor, invoiceCents, ledgerCents: ledger.amountCents, diffCents, status: diffCents === 0 ? "match" : "mismatch" };
  });

  const invoiceTotalCents = inPeriod.reduce((s, l) => s + l.amountCents, 0);
  const ledgerTotalCents = ref.ledger.filter((t) => t.period === period).reduce((s, t) => s + t.amountCents, 0);
  const splitTotal = split.reduce((s, r) => s + r.amountCents, 0);
  if (splitTotal !== invoiceTotalCents) throw new Error("internal error: tier split does not add up to the invoice total");

  return {
    period,
    split,
    vendors,
    anomalies,
    invoiceTotalCents,
    ledgerTotalCents,
    reconciled: anomalies.length === 0 && vendors.every((v) => v.status === "match"),
  };
}
