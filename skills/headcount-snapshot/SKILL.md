---
name: headcount-snapshot
description: One-page headcount snapshot by org (employees and contingent workers) for a leadership pre-read. Use when someone asks how many people are in each org, for a headcount summary, or for a pre-read on team size. Shows costs only if the caller's access includes them.
allowed-tools: mcp__plugin_ops-mcp_ops__headcount_report mcp__plugin_ops-mcp_ops__list_orgs
metadata:
  owner: strategy-portfolio-governance
  data-classification: confidential
  version: "1.0.0"
---

# Headcount snapshot

1. Call `headcount_report`.
2. Write a table: org, FTE, contingent, total; then a totals row you compute from the table.
3. If `fteSalaryCents` or `cwMonthlyCostCents` come back as `[redacted]`, leave the cost columns out and add one line: "Cost columns are not available with your access." Never estimate them.
4. If the cost columns are present, label the page "Confidential" and add them, converting cents to dollars.
5. Keep it to one page. No names; this is a count, not a roster.
