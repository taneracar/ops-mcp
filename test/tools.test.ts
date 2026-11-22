import { afterEach, describe, expect, it } from "vitest";
import * as seed from "../src/data/seed.js";
import { SCOPES } from "../src/policy.js";
import { TOOL_POLICY } from "../src/server.js";
import { connect } from "./helpers.js";

const READ = [SCOPES.read];
const FINANCE = [SCOPES.read, SCOPES.finance];
const FINANCE_PII = [SCOPES.read, SCOPES.finance, SCOPES.pii];
const EVERYTHING = [SCOPES.read, SCOPES.finance, SCOPES.pii, SCOPES.restricted];

let close: (() => Promise<void>) | undefined;
afterEach(async () => {
  await close?.();
  close = undefined;
});
async function as(scopes: string[]) {
  const c = await connect(scopes);
  close = c.close;
  return c;
}

describe("tool listing", () => {
  it("exposes exactly the tools in TOOL_POLICY, all read-only", async () => {
    const { client } = await as(READ);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.keys(TOOL_POLICY).sort());
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(true);
      expect(t.annotations?.destructiveHint).toBe(false);
    }
  });
});

describe("field-level redaction", () => {
  it("ops:read sees who someone is but not their email, salary or hire date", async () => {
    const { call } = await as(READ);
    const r = await call("find_people", { query: "okafor" });
    expect(r.isError).toBe(false);
    expect(r.json.classification).toBe("internal");
    expect(r.json.hiddenFields).toEqual(["baseSalaryCents", "email", "hireDate"]);
    expect(r.json.data[0]).toMatchObject({ name: "Maya Okafor", title: "Director, Platform Engineering", email: "[redacted]", baseSalaryCents: "[redacted]" });
  });

  it("ops:finance alone does not unlock a named person's salary (that is personal data)", async () => {
    const { call } = await as(FINANCE);
    const r = await call("find_people", { query: "okafor" });
    expect(r.json.data[0].baseSalaryCents).toBe("[redacted]");
  });

  it("finance + pii sees the salary and the result is labelled confidential", async () => {
    const { call } = await as(FINANCE_PII);
    const r = await call("find_people", { query: "okafor" });
    expect(r.json.data[0].baseSalaryCents).toBe(24_500_000);
    expect(r.json.data[0].email).toBe("maya.okafor@example.com");
    expect(r.json.classification).toBe("confidential");
    expect(r.json.hiddenFields).toEqual([]);
  });

  it("headcount costs are aggregate, so ops:finance sees them without ops:pii", async () => {
    const viewer = await (await as(READ)).call("headcount_report");
    expect(viewer.json.hiddenFields).toEqual(["cwMonthlyCostCents", "fteSalaryCents"]);
    expect(viewer.json.data.orgs.find((o: any) => o.orgId === "DWP")).toMatchObject({ fte: 3, contingent: 4, fteSalaryCents: "[redacted]" });
    await close?.();

    const fin = await (await as(FINANCE)).call("headcount_report");
    expect(fin.json.classification).toBe("confidential");
    const dwp = fin.json.data.orgs.find((o: any) => o.orgId === "DWP");
    expect(dwp.fteSalaryCents).toBe(17_500_000 + 13_300_000 + 10_800_000);
    const dwpInvoices = seed.invoiceLines.filter((l) => ["CW-01", "CW-02", "CW-03", "CW-04"].includes(l.cwId));
    expect(dwp.cwMonthlyCostCents).toBe(dwpInvoices.reduce((s, l) => s + l.amountCents, 0));
  });

  it("a derived number is as sensitive as its inputs: burn % is hidden with the budget", async () => {
    const { call } = await as(READ);
    const r = await call("portfolio_status", { status: "off_track" });
    expect(r.json.data).toHaveLength(1);
    expect(r.json.data[0]).toMatchObject({ id: "PRJ-503", burnPct: "[redacted]", budgetCents: "[redacted]" });
  });
});

describe("tool-level access", () => {
  it("vendor costs need ops:finance; the refusal names the scope and returns no data", async () => {
    const { call, audit } = await as(READ);
    const r = await call("vendor_cost_split", { period: "2026-10" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/ops:finance/);
    expect(r.text).not.toMatch(/Lumen|Harbor|\d{5,}/);
    expect(audit.events.at(-1)).toMatchObject({ tool: "vendor_cost_split", decision: "denied", rows: 0 });
  });

  it("an unannounced org change needs ops:restricted, even for a finance user", async () => {
    const { call } = await as(FINANCE_PII);
    const r = await call("org_change_brief", { changeId: "OC-2027-01" });
    expect(r.isError).toBe(true);
    expect(r.text).not.toMatch(/Digital Workplace|2027-01-15/);
  });

  it("with ops:restricted the brief comes back labelled and with live counts", async () => {
    const { call } = await as(EVERYTHING);
    const r = await call("org_change_brief", { changeId: "OC-2027-01" });
    expect(r.json.classification).toBe("restricted");
    expect(r.json.notice).toMatch(/RESTRICTED/);
    expect(r.json.data.affected.find((a: any) => a.orgId === "DWP")).toMatchObject({ fte: 3, contingent: 4 });
  });
});

describe("no leak for an ops:read caller across every tool it can call", () => {
  it("never returns an email, salary, budget, invoice amount or the unannounced plan", async () => {
    const { call } = await as(READ);
    const outputs = [
      await call("list_orgs"),
      await call("find_people", { query: "a", limit: 50 }).catch(() => null), // too short: rejected by schema
      await call("find_people", { query: "an", limit: 50 }),
      await call("find_people", { query: "Staffing", limit: 50 }),
      await call("headcount_report"),
      await call("portfolio_status"),
      await call("vendor_cost_split", { period: "2026-10" }),
      await call("reconcile_invoice_csv", { csv: "x", period: "2026-10" }),
      await call("org_change_brief", { changeId: "OC-2027-01" }),
    ];
    const all = outputs.map((o) => o?.text ?? "").join("\n");
    const secrets = [
      ...seed.workers.flatMap((w) => [w.email, String(w.baseSalaryCents), w.hireDate]),
      ...seed.contingentWorkers.flatMap((c) => [c.email, c.startDate]),
      ...seed.projects.flatMap((p) => [String(p.budgetCents), String(p.spendToDateCents)]),
      ...seed.invoiceLines.map((l) => String(l.amountCents)),
      ...seed.orgChanges.flatMap((c) => [c.id, c.title, c.effectiveDate]),
    ];
    for (const s of secrets) expect(all, `leaked ${s}`).not.toContain(s);
  });
});

describe("audit log", () => {
  it("records who called what and what was hidden, but never the argument values", async () => {
    const { call, audit } = await as(READ);
    await call("find_people", { query: "Natarajan" });
    const e = audit.events.at(-1)!;
    expect(e).toMatchObject({ subject: "tester", clientId: "test-client", tool: "find_people", decision: "allowed", rows: 1 });
    expect(e.hiddenFields).toEqual(["baseSalaryCents", "email", "hireDate"]);
    expect(e.argsDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(audit.events)).not.toMatch(/natarajan/i);
  });

  it("the same arguments in a different key order give the same digest", async () => {
    const { call, audit } = await as(READ);
    await call("find_people", { query: "kim", limit: 5 });
    await call("find_people", { limit: 5, query: "kim" });
    expect(audit.events[0]!.argsDigest).toBe(audit.events[1]!.argsDigest);
  });
});

describe("errors", () => {
  it("a period with no invoices says which periods exist", async () => {
    const { call } = await as(FINANCE);
    const r = await call("vendor_cost_split", { period: "2026-09" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/2026-10/);
  });

  it("a CSV without the required columns is an error, audited as such", async () => {
    const { call, audit } = await as(FINANCE);
    const r = await call("reconcile_invoice_csv", { csv: "a,b\n1,2", period: "2026-10" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/missing column/);
    expect(audit.events.at(-1)!.decision).toBe("error");
  });

  it("schema validation rejects bad input before the tool runs", async () => {
    const { call, audit } = await as(READ);
    const r = await call("find_people", { query: "x" });
    expect(r.isError).toBe(true);
    expect(audit.events).toHaveLength(0);
  });
});

describe("reconcile_invoice_csv end to end", () => {
  it("reconciles an uploaded export and keeps unparseable rows out of the totals", async () => {
    const { call } = await as(FINANCE);
    const header = "line_id,period,vendor,sow_id,cw_id,hours,rate,amount";
    const rows = seed.invoiceLines
      .filter((l) => l.vendor === "Cedar Ridge Consulting")
      .map((l) => [l.lineId, l.period, `"${l.vendor}"`, l.sowId, l.cwId, l.hours, (l.rateCents / 100).toFixed(2), `"$${(l.amountCents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}"`].join(","));
    const r = await call("reconcile_invoice_csv", { csv: [header, ...rows, "CR-9,2026-10,Cedar Ridge Consulting,SOW-301,CW-09,ten,140,1400"].join("\n"), period: "2026-10" });
    expect(r.isError).toBe(false);
    const cedar = r.json.data.vendors.find((v: any) => v.vendor === "Cedar Ridge Consulting");
    expect(cedar.status).toBe("match");
    expect(r.json.data.rowErrors).toEqual([{ row: 4, message: expect.stringMatching(/hour/) }]);
    // Other vendors are in the ledger but not in this file, so the whole month is not reconciled.
    expect(r.json.data.reconciled).toBe(false);
  });
});
