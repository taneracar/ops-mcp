---
name: vendor-cost-review
description: Monthly contingent-worker (CW) vendor cost review. Splits invoices by vendor and support tier, ties them to the AP ledger, and writes up every difference with the lines that cause it. Use when someone asks for the CW or vendor cost split, a SOW cost check, or to reconcile a vendor invoice spreadsheet for a month.
allowed-tools: mcp__plugin_ops-mcp_ops__vendor_cost_split mcp__plugin_ops-mcp_ops__reconcile_invoice_csv mcp__plugin_ops-mcp_ops__list_orgs
metadata:
  owner: strategy-portfolio-governance
  data-classification: confidential
  version: "1.0.0"
---

# Vendor cost review

Produces the monthly CW vendor cost split and says plainly whether it ties to the AP ledger.

## Inputs

- **Period** (`YYYY-MM`). If the user does not give one, ask. Do not assume the current month.
- Optionally a **CSV export** of the vendor invoice. If the user attaches one, use `reconcile_invoice_csv`; otherwise use `vendor_cost_split`, which reads the invoice lines already in the system.

## Steps

1. Call `vendor_cost_split` (or `reconcile_invoice_csv` with the file contents) for the period.
2. If the tool says access is denied, stop and say which scope is missing. Do not try other tools to rebuild the same numbers.
3. Build the report from the tool result only. Every dollar figure in the report must appear in the result (amounts are in cents; divide by 100 and format as `$1,234.56`).
4. Lead with the answer: **Reconciled** or **Not reconciled**, using the `reconciled` field, never your own judgment.
5. Then, in this order:
   - Vendor × tier split table: vendor, tier, lines, hours, amount; and a total row equal to `invoiceTotalCents`.
   - Ledger tie-out table: vendor, invoice, ledger, difference, status.
   - Findings: one bullet per anomaly with the line ids and the dollar impact. For each vendor with a difference, say which anomalies explain it and whether they explain all of it (sum the `impactCents`; if the sum differs from the difference, say the rest is unexplained).
   - `rowErrors` (CSV only): list the rows that were left out and why.
6. End with recommended next steps limited to what the findings support (for example "ask Lumen Tech Services for a credit memo for LT-2003"). Do not invent policy, approvers or deadlines.

## Handling

This output is **confidential** (vendor rates and spend). Label the report "Confidential" at the top. Do not include worker emails or other personal data even if a tool returns them; worker ids are enough.

## Example opening

> **Confidential: CW vendor cost review, October 2026: Not reconciled.**
> Invoices total $X; AP approved $Y. Lumen Tech Services is $Z over the ledger, fully explained by a duplicated line (LT-2002 / LT-2003).
