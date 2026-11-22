import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MemoryAuditSink } from "../src/audit.js";
import { JwtVerifier } from "../src/auth.js";
import { createHttpApp } from "../src/http.js";

// Real HTTP server on a random port, real RS256 tokens from an in-test "identity provider".
const ISSUER = "https://idp.example.test";
let server: Server;
let base: string;
let resource: string;
let signKey: CryptoKey;
let otherKey: CryptoKey;
const audit = new MemoryAuditSink();

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  resource = `${base}/mcp`;
  const app = createHttpApp({
    resourceUrl: new URL(resource),
    verifier: new JwtVerifier({ issuer: ISSUER, audience: resource, key: jwks }),
    authServer: {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      response_types_supported: ["code"],
    },
    audit,
  });
  server.on("request", app);
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

type TokenOpts = { scope?: string; aud?: string; iss?: string; exp?: string | number; key?: CryptoKey; sub?: string };
function token(o: TokenOpts = {}): Promise<string> {
  return new SignJWT({ scope: o.scope ?? "ops:read", client_id: "claude-code" })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setSubject(o.sub ?? "alice")
    .setIssuer(o.iss ?? ISSUER)
    .setAudience(o.aud ?? resource)
    .setIssuedAt()
    .setExpirationTime(o.exp ?? "5m")
    .sign(o.key ?? signKey);
}

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
});

async function post(auth?: string) {
  return fetch(resource, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: auth } : {}) },
    body: initBody,
  });
}

async function mcpClient(scope: string, sub = "alice") {
  const t = await token({ scope, sub });
  const client = new Client({ name: "http-test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${t}` } } }));
  return client;
}

describe("OAuth resource server", () => {
  it("publishes protected resource metadata (RFC 9728)", async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource/mcp`);
    expect(res.status).toBe(200);
    const meta = await res.json();
    expect(meta).toMatchObject({ resource, authorization_servers: [ISSUER] });
    expect(meta.scopes_supported).toEqual(["ops:read", "ops:finance", "ops:pii", "ops:restricted"]);
  });

  it("401 without a token, pointing the client at the metadata", async () => {
    const res = await post();
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain(`resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`);
  });

  it.each([
    ["minted for another server", { aud: "https://other.example.test/mcp" }],
    ["from another issuer", { iss: "https://evil.example.test" }],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["signed with the wrong key", { key: undefined as unknown as CryptoKey }],
  ])("401 for a token %s", async (_label, o) => {
    const opts: TokenOpts = { ...o };
    if ("key" in o) opts.key = otherKey;
    const res = await post(`Bearer ${await token(opts)}`);
    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/ERR_JWS|signature|audience/i); // no detail for the caller
  });

  it("401 for something that is not a JWT", async () => {
    expect((await post("Bearer not-a-jwt")).status).toBe(401);
  });

  it("405 for GET (stateless server, no SSE stream)", async () => {
    const res = await fetch(resource, { headers: { authorization: `Bearer ${await token()}` } });
    expect(res.status).toBe(405);
  });

  it("403 for a request with a foreign Host header (DNS rebinding protection)", async () => {
    const t = await token();
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(resource, { method: "POST", headers: { host: "attacker.example", "content-type": "application/json", authorization: `Bearer ${t}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end(initBody);
    });
    expect(status).toBe(403);
  });
});

describe("MCP over HTTP with a valid token", () => {
  it("scopes in the token decide what the caller sees", async () => {
    const viewer = await mcpClient("ops:read", "bob");
    const tools = await viewer.listTools();
    expect(tools.tools.length).toBe(7);
    const people = (await viewer.callTool({ name: "find_people", arguments: { query: "okafor" } })) as any;
    expect(JSON.parse(people.content[0].text).data[0].email).toBe("[redacted]");
    const costs = (await viewer.callTool({ name: "vendor_cost_split", arguments: { period: "2026-10" } })) as any;
    expect(costs.isError).toBe(true);
    await viewer.close();

    const finance = await mcpClient("ops:read ops:finance", "carol");
    const ok = (await finance.callTool({ name: "vendor_cost_split", arguments: { period: "2026-10" } })) as any;
    expect(JSON.parse(ok.content[0].text).data.reconciled).toBe(false);
    await finance.close();
  });

  it("audit events carry the token's subject and client id", async () => {
    const before = audit.events.length;
    const c = await mcpClient("ops:read", "dave");
    await c.callTool({ name: "list_orgs", arguments: {} });
    await c.close();
    const mine = audit.events.slice(before);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ subject: "dave", clientId: "claude-code", tool: "list_orgs", decision: "allowed" });
  });
});
