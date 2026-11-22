import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { type AuditSink, digestArgs } from "./audit.js";
import * as seed from "./data/seed.js";
import { AccessDenied, type FieldPolicy, type Level, maxLevel, type Principal, rank, redact, requireScopes, SCOPES } from "./policy.js";
import { fromSeedLines, parseInvoiceCsv, reconcile } from "./reconcile.js";

export const SERVER_NAME = "ops";
export const SERVER_VERSION = "0.1.0";

export type Dataset = {
  orgs: seed.Org[];
  workers: seed.Worker[];
  sows: seed.Sow[];
  contingentWorkers: seed.ContingentWorker[];
  invoiceLines: seed.InvoiceLine[];
  ledgerTotals: seed.LedgerTotal[];
  projects: seed.Project[];
  orgChanges: seed.OrgChange[];
};

export const seedDataset: Dataset = {
  orgs: seed.orgs,
  workers: seed.workers,
  sows: seed.sows,
  contingentWorkers: seed.contingentWorkers,
  invoiceLines: seed.invoiceLines,
  ledgerTotals: seed.ledgerTotals,
  projects: seed.projects,
  orgChanges: seed.orgChanges,
};

/**
 * What each tool needs and the most sensitive data it can return. The skills validator reads this
 * to check that a skill declaring "confidential" never lists a tool that can return restricted data.
 */
export const TOOL_POLICY = {
  list_orgs: { scopes: [SCOPES.read], maxLevel: "internal" },
  find_people: { scopes: [SCOPES.read], maxLevel: "confidential" },
  headcount_report: { scopes: [SCOPES.read], maxLevel: "confidential" },
  portfolio_status: { scopes: [SCOPES.read], maxLevel: "confidential" },
  vendor_cost_split: { scopes: [SCOPES.read, SCOPES.finance], maxLevel: "confidential" },
  reconcile_invoice_csv: { scopes: [SCOPES.read, SCOPES.finance], maxLevel: "confidential" },
  org_change_brief: { scopes: [SCOPES.read, SCOPES.restricted], maxLevel: "restricted" },
} as const satisfies Record<string, { scopes: readonly string[]; maxLevel: Level }>;

export type ToolName = keyof typeof TOOL_POLICY;

// Field-level policies. Anything not listed is hidden.
const workerPolicy: FieldPolicy<seed.Worker> = {
  id: { level: "internal" },
  name: { level: "internal" },
  email: { level: "internal", pii: true },
  orgId: { level: "internal" },
  title: { level: "internal" },
  managerId: { level: "internal" },
  location: { level: "internal" },
  baseSalaryCents: { level: "confidential", pii: true },
  hireDate: { level: "internal", pii: true },
};

const cwPolicy: FieldPolicy<seed.ContingentWorker> = {
  id: { level: "internal" },
  name: { level: "internal" },
  email: { level: "internal", pii: true },
  vendor: { level: "internal" },
  sowId: { level: "internal" },
  orgId: { level: "internal" },
  startDate: { level: "internal", pii: true },
};

type HeadcountRow = {
  orgId: string;
  orgName: string;
  fte: number;
  contingent: number;
  fteSalaryCents: number;
  cwMonthlyCostCents: number;
};
const headcountPolicy: FieldPolicy<HeadcountRow> = {
  orgId: { level: "internal" },
  orgName: { level: "internal" },
  fte: { level: "internal" },
  contingent: { level: "internal" },
  fteSalaryCents: { level: "confidential" },
  cwMonthlyCostCents: { level: "confidential" },
};

type ProjectRow = seed.Project & { burnPct: number };
const projectPolicy: FieldPolicy<ProjectRow> = {
  id: { level: "internal" },
  name: { level: "internal" },
  orgId: { level: "internal" },
  status: { level: "internal" },
  ownerId: { level: "internal" },
  budgetCents: { level: "confidential" },
  spendToDateCents: { level: "confidential" },
  // Derived from two confidential numbers, so it is confidential too.
  burnPct: { level: "confidential" },
};

type Envelope = { classification: Level; hiddenFields: string[]; data: unknown; notice?: string };

class ToolError extends Error {}

function ok(env: Envelope): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(env, null, 2) }] };
}

function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function countRows(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const arrays = Object.values(data).filter(Array.isArray) as unknown[][];
    return arrays.reduce((s, a) => s + a.length, 0);
  }
  return data === undefined ? 0 : 1;
}

export type ServerDeps = {
  principal: Principal;
  audit: AuditSink;
  data?: Dataset;
  now?: () => Date;
};

/**
 * Builds an MCP server bound to one caller. Over HTTP a fresh server is built per request from the
 * verified token, so a tool can never see another caller's identity.
 */
export function createOpsServer({ principal, audit, data = seedDataset, now = () => new Date() }: ServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Read-only access to the operations office's org, contingent-workforce, vendor-cost and portfolio data. " +
        "Every result has a `classification` and a `hiddenFields` list: fields shown as \"[redacted]\" are hidden by policy " +
        "for this caller; say they are not available rather than guessing them. Money is in integer cents.",
    },
  );

  function governed<A>(name: ToolName, handler: (args: A) => Envelope): (args: A) => Promise<CallToolResult> {
    return async (args: A) => {
      const base = { ts: now().toISOString(), subject: principal.subject, clientId: principal.clientId, tool: name, argsDigest: digestArgs(args) };
      try {
        requireScopes(principal, name, TOOL_POLICY[name].scopes);
      } catch (e) {
        if (!(e instanceof AccessDenied)) throw e;
        audit.write({ ...base, decision: "denied", hiddenFields: [], rows: 0, detail: `missing ${e.missing.join(",")}` });
        return fail(`Access denied: ${name} needs scope ${e.missing.join(", ")}. Ask the data owner for access; do not try another tool to get the same data.`);
      }
      try {
        const env = handler(args);
        const hidden = [...new Set(env.hiddenFields)].sort();
        audit.write({ ...base, decision: "allowed", hiddenFields: hidden, rows: countRows(env.data) });
        return ok({ ...env, hiddenFields: hidden });
      } catch (e) {
        const message = e instanceof ToolError ? e.message : "internal error";
        audit.write({ ...base, decision: "error", hiddenFields: [], rows: 0, detail: message });
        return fail(message);
      }
    };
  }

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const orgName = (id: string) => data.orgs.find((o) => o.id === id)?.name ?? id;

  server.registerTool(
    "list_orgs",
    {
      title: "List organizations",
      description: "Organizations with cost center, FTE count and contingent-worker count.",
      inputSchema: {},
      annotations: readOnly,
    },
    governed("list_orgs", () => ({
      classification: "internal",
      hiddenFields: [],
      data: data.orgs.map((o) => ({
        ...o,
        fte: data.workers.filter((w) => w.orgId === o.id).length,
        contingent: data.contingentWorkers.filter((c) => c.orgId === o.id).length,
      })),
    })),
  );

  server.registerTool(
    "find_people",
    {
      title: "Find people",
      description:
        "Search employees (FTE) and contingent workers by name, title, org id or vendor. Personal fields (email, salary, dates) are redacted unless the caller holds ops:pii, and salary also needs ops:finance.",
      inputSchema: {
        query: z.string().trim().min(2).max(100).describe("Case-insensitive text to match"),
        limit: z.number().int().min(1).max(50).default(20),
      },
      annotations: readOnly,
    },
    governed("find_people", ({ query, limit }: { query: string; limit: number }) => {
      const q = query.toLowerCase();
      const hidden: string[] = [];
      const levels: Level[] = [];
      const people = [
        ...data.workers
          .filter((w) => [w.name, w.title, w.orgId].some((f) => f.toLowerCase().includes(q)))
          .map((w) => {
            const r = redact(principal, w, workerPolicy);
            hidden.push(...r.hidden);
            levels.push(r.level);
            return { type: "employee", ...r.row };
          }),
        ...data.contingentWorkers
          .filter((c) => [c.name, c.vendor, c.orgId].some((f) => f.toLowerCase().includes(q)))
          .map((c) => {
            const r = redact(principal, c, cwPolicy);
            hidden.push(...r.hidden);
            levels.push(r.level);
            return { type: "contingent", ...r.row };
          }),
      ].slice(0, limit);
      return { classification: maxLevel(levels, "internal"), hiddenFields: hidden, data: people };
    }),
  );

  server.registerTool(
    "headcount_report",
    {
      title: "Headcount by org",
      description: "FTE and contingent headcount per org; cost columns need ops:finance.",
      inputSchema: {},
      annotations: readOnly,
    },
    governed("headcount_report", () => {
      const hidden: string[] = [];
      const levels: Level[] = [];
      const rows = data.orgs.map((o) => {
        const fte = data.workers.filter((w) => w.orgId === o.id);
        const cws = data.contingentWorkers.filter((c) => c.orgId === o.id);
        const row: HeadcountRow = {
          orgId: o.id,
          orgName: o.name,
          fte: fte.length,
          contingent: cws.length,
          fteSalaryCents: fte.reduce((s, w) => s + w.baseSalaryCents, 0),
          cwMonthlyCostCents: data.invoiceLines
            .filter((l) => l.period === latestPeriod(data) && cws.some((c) => c.id === l.cwId))
            .reduce((s, l) => s + l.amountCents, 0),
        };
        const r = redact(principal, row, headcountPolicy);
        hidden.push(...r.hidden);
        levels.push(r.level);
        return r.row;
      });
      return {
        classification: maxLevel(levels, "internal"),
        hiddenFields: hidden,
        data: { costPeriod: latestPeriod(data), orgs: rows },
      };
    }),
  );

  server.registerTool(
    "portfolio_status",
    {
      title: "Portfolio status",
      description: "Projects with status and owner; budget, spend and burn % need ops:finance.",
      inputSchema: {
        status: z.enum(["on_track", "at_risk", "off_track", "done"]).optional(),
      },
      annotations: readOnly,
    },
    governed("portfolio_status", ({ status }: { status?: seed.Project["status"] }) => {
      const hidden: string[] = [];
      const levels: Level[] = [];
      const rows = data.projects
        .filter((p) => !status || p.status === status)
        .map((p) => {
          const burnPct = Math.round((p.spendToDateCents / p.budgetCents) * 1000) / 10;
          const r = redact(principal, { ...p, burnPct }, projectPolicy);
          hidden.push(...r.hidden);
          levels.push(r.level);
          return { ...r.row, orgName: orgName(p.orgId) };
        });
      return { classification: maxLevel(levels, "internal"), hiddenFields: hidden, data: rows };
    }),
  );

  server.registerTool(
    "vendor_cost_split",
    {
      title: "Vendor cost split and reconciliation",
      description:
        "Splits the month's contingent-worker invoices by vendor and support tier, ties each vendor's total to the AP ledger, and lists anomalies (duplicates, rate above SOW card, amount errors, over cap). `reconciled` is true only if every check passes.",
      inputSchema: {
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe("YYYY-MM"),
      },
      annotations: readOnly,
    },
    governed("vendor_cost_split", ({ period }: { period: string }) => {
      const lines = data.invoiceLines.filter((l) => l.period === period);
      if (lines.length === 0) throw new ToolError(`No invoice lines for ${period}. Periods with data: ${periods(data).join(", ")}`);
      return {
        classification: "confidential",
        hiddenFields: [],
        data: reconcile(period, fromSeedLines(lines), refOf(data)),
      };
    }),
  );

  server.registerTool(
    "reconcile_invoice_csv",
    {
      title: "Reconcile an invoice spreadsheet",
      description:
        "Same checks as vendor_cost_split, on a CSV export the user provides (columns: line_id, period, vendor, sow_id, cw_id, hours, rate, amount). Rows that do not parse are listed in rowErrors and left out of every total.",
      inputSchema: {
        csv: z.string().min(1).max(1_000_000),
        period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
      },
      annotations: readOnly,
    },
    governed("reconcile_invoice_csv", ({ csv, period }: { csv: string; period: string }) => {
      let parsed;
      try {
        parsed = parseInvoiceCsv(csv);
      } catch (e) {
        throw new ToolError((e as Error).message);
      }
      const result = reconcile(period, parsed.lines, refOf(data));
      return {
        classification: "confidential",
        hiddenFields: [],
        data: { ...result, reconciled: result.reconciled && parsed.errors.length === 0, rowErrors: parsed.errors },
      };
    }),
  );

  server.registerTool(
    "org_change_brief",
    {
      title: "Planned org change brief",
      description:
        "Facts for an org-change one-pager: affected orgs, current FTE and contingent headcount, roles not backfilled, vendor SOWs involved. Restricted: unannounced plans, need-to-know only.",
      inputSchema: { changeId: z.string().min(1).max(40) },
      annotations: readOnly,
    },
    governed("org_change_brief", ({ changeId }: { changeId: string }) => {
      const change = data.orgChanges.find((c) => c.id === changeId);
      if (!change) throw new ToolError(`No org change ${changeId}. Known: ${data.orgChanges.map((c) => c.id).join(", ")}`);
      const affected = change.affectedOrgIds.map((id) => ({
        orgId: id,
        orgName: orgName(id),
        fte: data.workers.filter((w) => w.orgId === id).length,
        contingent: data.contingentWorkers.filter((c) => c.orgId === id).length,
        sows: data.sows.filter((s) => s.orgId === id).map((s) => `${s.id} (${s.vendor}, ${s.tier})`),
      }));
      return {
        classification: "restricted",
        hiddenFields: [],
        notice: change.announced ? undefined : "RESTRICTED: not announced. Do not share outside the named recipients.",
        data: { ...change, affected },
      };
    }),
  );

  return server;
}

function refOf(data: Dataset) {
  return { sows: data.sows, cws: data.contingentWorkers, ledger: data.ledgerTotals };
}

function periods(data: Dataset): string[] {
  return [...new Set(data.invoiceLines.map((l) => l.period))].sort();
}

function latestPeriod(data: Dataset): string {
  return periods(data).at(-1) ?? "";
}

/** Highest classification any listed tool can return. */
export function maxLevelOf(tools: ToolName[]): Level {
  return tools.reduce<Level>((m, t) => (rank(TOOL_POLICY[t].maxLevel) > rank(m) ? TOOL_POLICY[t].maxLevel : m), "public");
}
