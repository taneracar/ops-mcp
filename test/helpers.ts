import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { MemoryAuditSink } from "../src/audit.js";
import { principal } from "../src/policy.js";
import { createOpsServer, type Dataset } from "../src/server.js";

export type CallResult = { isError: boolean; text: string; json: any };

export async function connect(scopes: string[], opts: { data?: Dataset } = {}) {
  const audit = new MemoryAuditSink();
  const server = createOpsServer({
    principal: principal("tester", "test-client", scopes),
    audit,
    data: opts.data,
    now: () => new Date("2026-11-22T12:00:00Z"),
  });
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);

  async function call(name: string, args: Record<string, unknown> = {}): Promise<CallResult> {
    const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] };
    const text = r.content.map((c) => c.text).join("\n");
    let json: any = undefined;
    try {
      json = JSON.parse(text);
    } catch {
      /* error results are plain text */
    }
    return { isError: Boolean(r.isError), text, json };
  }

  return { client, call, audit, close: () => client.close() };
}
