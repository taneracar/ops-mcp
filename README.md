# ops-mcp

An MCP server that gives Claude (or any MCP client) governed, read-only access to an operations office's data: org and headcount, contingent workers (CW) and vendor invoices, and the project portfolio. It is packaged as a Claude Code plugin with two skills that turn recurring asks into repeatable reports.

The interesting part is the governance, not the data:

- **Scopes decide what a tool returns, field by field.** The same `find_people` call shows a name and title to one caller, and an email and salary to another. Hidden fields come back as `"[redacted]"` and are listed in `hiddenFields`, so the model can say "not available to you" instead of guessing.
- **Personal data is a separate grant.** `ops:finance` shows aggregate salary cost per org but not a named person's salary; that also needs `ops:pii`.
- **Every call is audited without logging the arguments.** The audit line has who, which client, which tool, what was hidden and how many rows, plus a SHA-256 digest of the arguments (they can contain names).
- **Over HTTP it is an OAuth 2.1 resource server.** It verifies JWT access tokens from your identity provider (signature, issuer, audience, expiry) and publishes RFC 9728 metadata so MCP clients know where to get a token.
- **Skills are certified before they ship.** A validator checks each skill's metadata, that it only lists tools that exist, and that its data-classification label is at least as high as the most sensitive data its tools can return. It runs in CI.

All data is synthetic. Every person, vendor, figure and plan in `src/data/seed.ts` is made up.

## Tools

| tool | scopes | can return | what it does |
|---|---|---|---|
| `list_orgs` | `ops:read` | internal | orgs, cost centers, FTE and CW counts |
| `find_people` | `ops:read` | confidential | search employees and CWs; email, hire/start date need `ops:pii`, salary needs `ops:finance` + `ops:pii` |
| `headcount_report` | `ops:read` | confidential | FTE/CW per org; cost columns need `ops:finance` |
| `portfolio_status` | `ops:read` | confidential | projects and status; budget, spend and burn % need `ops:finance` |
| `vendor_cost_split` | `ops:read` `ops:finance` | confidential | CW invoices split by vendor × support tier, tied to the AP ledger, with anomalies |
| `reconcile_invoice_csv` | `ops:read` `ops:finance` | confidential | the same checks on a CSV export the user provides |
| `org_change_brief` | `ops:read` `ops:restricted` | restricted | facts for an unannounced org-change one-pager, labelled need-to-know |

All tools are annotated read-only. Classification levels are cumulative (`restricted` needs `ops:read` and `ops:finance` too), and a field with no policy rule is hidden from everyone, so a new column never leaks by default. A number derived from confidential inputs (burn % from budget and spend) is classified confidential too.

### Vendor cost reconciliation

`vendor_cost_split` is the monthly report an ops office sends: CW spend by vendor and support tier, tied to what AP approved. It only says `reconciled: true` if every vendor matches the ledger and no line breaks the SOW terms. It checks for duplicated lines, rates above the SOW rate card, amounts that are not hours × rate, unknown SOWs or workers, a worker billed to a SOW they are not on, SOWs over their monthly cap, and lines from another month. All money is integer cents; hours × rate is computed in integers and rounded half-up once.

The seeded October 2026 data has two planted problems, and the tool finds both:

| vendor | invoice | AP ledger | difference |
|---|---|---|---|
| Cedar Ridge Consulting | $42,070.00 | $42,070.00 | $0.00 |
| Harbor Point Staffing | $33,744.00 | $33,744.00 | $0.00 |
| Lumen Tech Services | $71,080.00 | $58,840.00 | $12,240.00 |

- `duplicate_line` LT-2002 / LT-2003: the same 144 hours billed twice, $12,240.00. This explains all of Lumen's difference.
- `rate_above_card` HP-1002: billed $54/h against a $48/h card, $912.00 over. Harbor still ties to the ledger, because AP paid it. Tying to the ledger and being correct are different checks.

`reconcile_invoice_csv` accepts the spreadsheet export instead (columns in any order, quoted fields, `$1,234.56` amounts, CRLF, BOM). Rows that do not parse are returned in `rowErrors` with their row number and left out of every total, and the result is not reconciled while any remain.

## Skills

`skills/` holds two skills in the Agent Skills format (`SKILL.md` with frontmatter):

- **vendor-cost-review**: runs the reconciliation and writes the report in a fixed order: verdict from the `reconciled` field, split table, ledger tie-out, findings with line ids and dollar impact, then whether the anomalies explain the whole difference.
- **headcount-snapshot**: a one-page headcount table; if the cost fields come back redacted it leaves them out and says so instead of estimating.

Each skill declares `allowed-tools` (with the names Claude Code gives plugin tools, `mcp__plugin_ops-mcp_ops__<tool>`), an owner, a version and a `data-classification`. `npm run validate-skills` is the certification step:

```
ok    headcount-snapshot  [confidential]  tools: headcount_report, list_orgs
ok    vendor-cost-review  [confidential]  tools: vendor_cost_split, reconcile_invoice_csv, list_orgs
```

It fails a skill whose name does not match its folder, whose description does not say when to use it, that lists a tool from another server or one that does not exist, that is labelled `internal` but lists a tool that can return `confidential` data, or whose instructions mention a tool it is not allowed to call. Claude Code's own `claude plugin validate --strict` also passes on the manifest and the skills folder.

## Running it

```bash
npm install
npm run check          # typecheck + tests + skill certification
npm run smoke          # starts the real stdio and HTTP servers and talks to them with the MCP client
```

### In Claude Code (stdio)

The repo is a Claude Code plugin (`.claude-plugin/plugin.json`, `.mcp.json`, `skills/`). Load it for a session with:

```bash
cd /path/to/ops-mcp && npm install
claude --plugin-dir /path/to/ops-mcp
```

`claude mcp list` then shows `plugin:ops-mcp:ops ... ✔ Connected`, and the tools appear as `mcp__plugin_ops-mcp_ops__<tool>`.

Over stdio there is no token, so scopes come from `OPS_MCP_SCOPES` in `.mcp.json` (`ops:read ops:finance` there). That is a local convenience, not access control: whoever edits the config chooses the scopes. Shared use goes over HTTP.

### Over HTTP with OAuth

```bash
# Real identity provider: tokens must have aud = the MCP URL and scopes in `scope` or `scp`
OPS_MCP_ISSUER=https://login.example.com OPS_MCP_RESOURCE_URL=https://ops-mcp.example.com/mcp npm run start:http

# Local development only: HS256 tokens from a shared secret (refused unless the URL is localhost)
export OPS_MCP_DEV_SECRET=$(openssl rand -hex 32)
npm run start:http
npm run dev-token -- --scopes "ops:read ops:finance" --sub alice
```

Without a valid token the server answers 401 with a `WWW-Authenticate` header that points to `/.well-known/oauth-protected-resource/mcp`. A token minted for another server, from another issuer, expired, or signed with another key is refused with the same generic message; the reason is only logged server-side. The audience is checked twice, by the JWT verification and again by the MCP SDK's middleware against the `aud` in the token. The server is stateless (a fresh MCP server per request, built from that request's token) and keeps the SDK's DNS-rebinding protection on localhost.

## How it was tested

- **77 Vitest tests**: policy (cumulative clearance, PII grant, deny by default), money and CSV parsing, reconciliation (every anomaly kind, plus 300 random invoices checking that the tier split, vendor totals and invoice total always agree), every tool through a real MCP client over an in-memory transport, the HTTP server on a real port with RS256 tokens from an in-test identity provider, the JWT verifier, and the skill validator against 15 broken skills.
- **A leak test**: an `ops:read` caller calls every tool, and the combined output is searched for every seeded email, salary, hire date, budget, invoice amount and the unannounced plan. None appear.
- **Mutation check**: 10 deliberate bugs (PII check removed, non-cumulative clearance, fields without a rule allowed, finance scope dropped from vendor costs, burn % treated as internal, raw arguments in the audit log, duplicate detection keyed by line id, half-down rounding, skill classification not checked, restricted brief without the restricted scope). The suite caught all 10.
- **Smoke test** against real processes (stdio spawned the way Claude Code spawns it; HTTP in dev mode with a minted token), also in CI.
- Writing the tests found two real problems in the first version: the 401 body named the JWT failure reason (signature vs. audience vs. expiry), and the seeded Cedar Ridge SOW was over its monthly cap, which the reconciliation flagged before I had noticed it.

CI runs typecheck, tests, skill certification and the smoke test on Node 22 and 24.

## Limits

- Synthetic data in memory. There are no connectors to Workday, ServiceNow, SharePoint or an AP system; `Dataset` is the seam where those would go.
- Read-only on purpose. A write tool (posting a report, opening a ticket) would need an approval step, which this server does not have.
- It is a resource server only. It does not issue tokens or register clients; a real deployment needs an identity provider configured with these scopes and the server's URL as audience.
- Redaction is by field. It does not stop an `ops:read` caller from learning something by combining allowed fields (small-group counts, for example); that needs aggregation thresholds.
- The skills have not been run against a model in this repo; the tests cover the server and the validator, not report quality.

## Layout

```
src/policy.ts       scopes, classification levels, field-level redaction
src/server.ts       MCP tools and their access policy
src/reconcile.ts    CSV parsing and vendor cost reconciliation
src/money.ts        integer-cent parsing and arithmetic
src/audit.ts        audit events, argument digest
src/auth.ts         JWT access-token verifier
src/http.ts         Streamable HTTP + OAuth resource server
src/stdio.ts        local stdio entry point
src/skills.ts       skill certification
skills/             the two skills
.claude-plugin/     Claude Code plugin manifest
```

MIT licensed.
