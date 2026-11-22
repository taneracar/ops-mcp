import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileAuditSink } from "./audit.js";
import { principal, SCOPES } from "./policy.js";
import { createOpsServer } from "./server.js";

// Local stdio mode for Claude Code / Claude Desktop on your own machine. There is no token here,
// so the caller's scopes come from OPS_MCP_SCOPES (default: ops:read only). That is a local
// convenience, not access control: anyone who can edit the config can grant themselves anything.
// Shared deployments use the HTTP server, where scopes come from a verified OAuth token.

const scopes = (process.env.OPS_MCP_SCOPES ?? SCOPES.read).split(/[\s,]+/).filter(Boolean);
const who = principal(process.env.USER ?? "local-user", "stdio", scopes);
const audit = new FileAuditSink(process.env.OPS_MCP_AUDIT_LOG ?? "audit/stdio.jsonl");

const server = createOpsServer({ principal: who, audit });
await server.connect(new StdioServerTransport());
console.error(`ops-mcp (stdio) ready; scopes: ${scopes.join(" ")}`);
