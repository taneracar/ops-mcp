// End-to-end smoke test against real processes: the stdio server spawned the way Claude Code
// spawns it, and the HTTP server in dev mode with a minted token. Run: npm run smoke
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SignJWT } from "jose";

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`smoke failed: ${msg}`);
  console.log(`ok  ${msg}`);
}

const text = (r: any) => JSON.parse(r.content[0].text);

// 1. stdio
{
  const client = new Client({ name: "smoke", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/stdio.ts"],
      env: { ...process.env, OPS_MCP_SCOPES: "ops:read ops:finance", OPS_MCP_AUDIT_LOG: "audit/smoke-stdio.jsonl" } as Record<string, string>,
      stderr: "ignore",
    }),
  );
  const { tools } = await client.listTools();
  check(tools.length === 7, "stdio: 7 tools listed");
  const r = text(await client.callTool({ name: "vendor_cost_split", arguments: { period: "2026-10" } }));
  check(r.data.reconciled === false && r.data.anomalies.length === 2, "stdio: October not reconciled, 2 findings");
  const p = text(await client.callTool({ name: "find_people", arguments: { query: "reyes" } }));
  check(p.data[0].baseSalaryCents === "[redacted]", "stdio: salary redacted without ops:pii");
  await client.close();
}

// 2. HTTP, dev mode
{
  const port = 3399;
  const secret = "smoke-test-secret-smoke-test-secret";
  const child = spawn(process.execPath, ["--import", "tsx", "src/http.ts"], {
    env: { ...process.env, PORT: String(port), OPS_MCP_DEV_SECRET: secret, OPS_MCP_AUDIT_LOG: "audit/smoke-http.jsonl" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let ready = false;
  child.stderr.on("data", (d: Buffer) => (ready ||= d.toString().includes("listening")));
  for (let i = 0; i < 100 && !ready; i++) await sleep(100);
  try {
    check(ready, "http: server started");
    const url = `http://localhost:${port}/mcp`;
    const anon = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    check(anon.status === 401, "http: 401 without a token");
    const token = await new SignJWT({ scope: "ops:read", client_id: "smoke" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("smoke-user")
      .setIssuer(`http://localhost:${port}/dev-issuer`)
      .setAudience(url)
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));
    const client = new Client({ name: "smoke", version: "0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const orgs = text(await client.callTool({ name: "list_orgs", arguments: {} }));
    check(orgs.data.length === 4, "http: list_orgs with a valid token");
    const denied = (await client.callTool({ name: "vendor_cost_split", arguments: { period: "2026-10" } })) as any;
    check(denied.isError === true, "http: vendor costs denied for ops:read");
    await client.close();
  } finally {
    child.kill();
  }
}
console.log("smoke passed");
