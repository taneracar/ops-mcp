import { describe, expect, it } from "vitest";
import * as seed from "../src/data/seed.js";
import { formatCents, lineAmountCents, parseHoursToHundredths, parseMoneyToCents } from "../src/money.js";
import { fromSeedLines, type ParsedLine, parseCsv, parseInvoiceCsv, reconcile, type Reference } from "../src/reconcile.js";

const ref: Reference = { sows: seed.sows, cws: seed.contingentWorkers, ledger: seed.ledgerTotals };

describe("money", () => {
  it("parses spreadsheet-style amounts exactly", () => {
    expect(parseMoneyToCents("1,234.5")).toBe(123_450);
    expect(parseMoneyToCents("$1,234.56")).toBe(123_456);
    expect(parseMoneyToCents("(12.00)")).toBe(-1_200);
    expect(parseMoneyToCents("-0.07")).toBe(-7);
    expect(parseMoneyToCents("19.99")).toBe(1_999); // 19.99 * 100 is 1998.9999... as a float
    expect(() => parseMoneyToCents("12.345")).toThrow();
    expect(() => parseMoneyToCents("abc")).toThrow();
  });

  it("multiplies hours by rate in integers, half-up to the cent", () => {
    expect(lineAmountCents(parseHoursToHundredths("140.5"), 14_000)).toBe(1_967_000);
    expect(lineAmountCents(parseHoursToHundredths("0.01"), 4_850)).toBe(49); // 48.5 → 49
    expect(lineAmountCents(parseHoursToHundredths("0.01"), 4_849)).toBe(48);
    expect(() => parseHoursToHundredths("1.234")).toThrow();
  });

  it("formats cents", () => {
    expect(formatCents(122_400_000)).toBe("$1,224,000.00");
    expect(formatCents(-5)).toBe("-$0.05");
  });
});

describe("parseCsv", () => {
  it("handles quotes, doubled quotes, commas in fields, CRLF and a BOM", () => {
    const rows = parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/unterminated/);
  });
});

describe("parseInvoiceCsv", () => {
  it("reads columns in any order and reports bad rows without dropping good ones", () => {
    const csv = [
      "amount,hours,rate,cw_id,sow_id,vendor,period,line_id",
      '"$7,680.00",160,48.00,CW-01,SOW-101,Harbor Point Staffing,2026-10,HP-1',
      "100,abc,48,CW-02,SOW-101,Harbor Point Staffing,2026-10,HP-2",
      "100,1,48,CW-02,SOW-101,Harbor Point Staffing,2026-13,HP-3",
    ].join("\n");
    const { lines, errors } = parseInvoiceCsv(csv);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineId: "HP-1", amountCents: 768_000, hoursHundredths: 16_000, rateCents: 4_800 });
    expect(errors.map((e) => e.row)).toEqual([3, 4]);
  });

  it("refuses a file without the required columns", () => {
    expect(() => parseInvoiceCsv("line_id,amount\nX,1")).toThrow(/missing column/);
  });
});

describe("reconcile the seeded October invoices", () => {
  const r = reconcile("2026-10", fromSeedLines(seed.invoiceLines), ref);

  it("is not reconciled, and says exactly why", () => {
    expect(r.reconciled).toBe(false);
    expect(r.anomalies.map((a) => a.kind).sort()).toEqual(["duplicate_line", "rate_above_card"]);
    const dup = r.anomalies.find((a) => a.kind === "duplicate_line")!;
    expect(dup.lineIds).toEqual(["LT-2002", "LT-2003"]);
    expect(dup.impactCents).toBe(144 * 8_500);
    const rate = r.anomalies.find((a) => a.kind === "rate_above_card")!;
    expect(rate.lineIds).toEqual(["HP-1002"]);
    expect(rate.impactCents).toBe(152 * (5_400 - 4_800));
  });

  it("ties each vendor to the ledger; the Lumen difference equals the duplicate", () => {
    const byVendor = Object.fromEntries(r.vendors.map((v) => [v.vendor, v]));
    expect(byVendor["Harbor Point Staffing"]!.status).toBe("match");
    expect(byVendor["Cedar Ridge Consulting"]!.status).toBe("match");
    expect(byVendor["Lumen Tech Services"]).toMatchObject({ status: "mismatch", diffCents: 1_224_000 });
    expect(r.invoiceTotalCents - r.ledgerTotalCents).toBe(1_224_000);
  });

  it("splits by vendor and tier, and the split adds up to the invoice", () => {
    expect(r.split.map((s) => `${s.vendor}/${s.tier}`)).toEqual([
      "Cedar Ridge Consulting/L3",
      "Harbor Point Staffing/L1",
      "Harbor Point Staffing/L2",
      "Lumen Tech Services/L2",
      "Lumen Tech Services/L3",
    ]);
    expect(r.split.reduce((s, x) => s + x.amountCents, 0)).toBe(r.invoiceTotalCents);
    expect(r.split.find((s) => s.vendor === "Cedar Ridge Consulting")!.hours).toBe(300.5);
  });
});

describe("reconcile detects each kind of problem", () => {
  const good = (over: Partial<ParsedLine> = {}): ParsedLine => ({
    lineId: "L1",
    period: "2026-10",
    vendor: "Cedar Ridge Consulting",
    sowId: "SOW-301",
    cwId: "CW-09",
    hoursHundredths: 1_000,
    rateCents: 14_000,
    amountCents: 140_000,
    ...over,
  });
  const refWith = (lines: ParsedLine[]): Reference => ({
    ...ref,
    ledger: [{ period: "2026-10", vendor: "Cedar Ridge Consulting", amountCents: lines.filter((l) => l.period === "2026-10").reduce((s, l) => s + l.amountCents, 0) }],
  });
  const kinds = (lines: ParsedLine[], r = refWith(lines)) => reconcile("2026-10", lines, r).anomalies.map((a) => a.kind);

  it("a clean invoice that matches the ledger is reconciled", () => {
    const lines = [good()];
    const r = reconcile("2026-10", lines, refWith(lines));
    expect(r.anomalies).toEqual([]);
    expect(r.reconciled).toBe(true);
  });

  it("amount that is not hours × rate", () => expect(kinds([good({ amountCents: 140_001 })])).toContain("amount_mismatch"));
  it("unknown SOW", () => expect(kinds([good({ sowId: "SOW-999" })])).toContain("unknown_sow"));
  it("unknown worker", () => expect(kinds([good({ cwId: "CW-99" })])).toContain("unknown_cw"));
  it("worker billed to a SOW they are not on", () => expect(kinds([good({ cwId: "CW-01" })])).toContain("cw_not_on_sow"));
  it("SOW of another vendor", () => expect(kinds([good({ vendor: "Lumen Tech Services" })])).toContain("vendor_mismatch"));
  it("repeated line id", () => expect(kinds([good(), good({ hoursHundredths: 500, amountCents: 70_000 })])).toContain("duplicate_line_id"));
  it("SOW over its monthly cap", () => {
    const big = good({ hoursHundredths: 35_000, amountCents: 4_900_000 });
    expect(kinds([big])).toContain("over_monthly_cap");
  });
  it("a line from another month is flagged and left out of the totals", () => {
    const lines = [good(), good({ lineId: "L2", period: "2026-09" })];
    const r = reconcile("2026-10", lines, refWith(lines));
    expect(r.anomalies.map((a) => a.kind)).toEqual(["wrong_period"]);
    expect(r.invoiceTotalCents).toBe(140_000);
  });
  it("a vendor with no ledger total is not reconciled", () => {
    const r = reconcile("2026-10", [good()], { ...ref, ledger: [] });
    expect(r.vendors[0]!.status).toBe("no_ledger_total");
    expect(r.reconciled).toBe(false);
  });
});

describe("reconcile invariants over random invoices", () => {
  // Small deterministic PRNG so failures reproduce.
  let s = 42;
  const rnd = (n: number) => ((s = (s * 1_103_515_245 + 12_345) % 2 ** 31), s % n);

  it("split total, vendor totals and invoice total always agree", () => {
    for (let run = 0; run < 300; run++) {
      const lines: ParsedLine[] = Array.from({ length: 1 + rnd(25) }, (_, i) => {
        const cw = seed.contingentWorkers[rnd(seed.contingentWorkers.length)]!;
        const hours = rnd(20_000);
        const rate = 1_000 + rnd(20_000);
        return {
          lineId: `R${i}`,
          period: rnd(10) === 0 ? "2026-09" : "2026-10",
          vendor: cw.vendor,
          sowId: cw.sowId,
          cwId: cw.id,
          hoursHundredths: hours,
          rateCents: rate,
          amountCents: lineAmountCents(hours, rate) + (rnd(8) === 0 ? 1 : 0),
        };
      });
      const r = reconcile("2026-10", lines, ref);
      const inPeriod = lines.filter((l) => l.period === "2026-10").reduce((a, l) => a + l.amountCents, 0);
      expect(r.invoiceTotalCents).toBe(inPeriod);
      expect(r.split.reduce((a, x) => a + x.amountCents, 0)).toBe(inPeriod);
      expect(r.vendors.reduce((a, v) => a + v.invoiceCents, 0)).toBe(inPeriod);
      if (r.reconciled) expect(r.anomalies).toEqual([]);
    }
  });
});
