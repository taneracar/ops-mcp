import { pathToFileURL } from "node:url";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Express, Request, Response } from "express";
import { type AuditSink, FileAuditSink } from "./audit.js";
import { JwtVerifier, jwksKey } from "./auth.js";
import { ALL_SCOPES, principal } from "./policy.js";
import { createOpsServer, type Dataset } from "./server.js";

export type HttpOptions = {
  /** Public URL of the MCP endpoint, e.g. https://ops-mcp.internal.example/mcp. Also the token audience. */
  resourceUrl: URL;
  verifier: OAuthTokenVerifier;
  authServer: OAuthMetadata;
  audit: AuditSink;
  host?: string;
  data?: Dataset;
};

export function createHttpApp(opts: HttpOptions): Express {
  const app = createMcpExpressApp({ host: opts.host ?? "127.0.0.1" });

  // RFC 9728: tells an MCP client which authorization server to get a token from and which scopes exist.
  app.use(
    mcpAuthMetadataRouter({
      oauthMetadata: opts.authServer,
      resourceServerUrl: opts.resourceUrl,
      scopesSupported: ALL_SCOPES,
      resourceName: "Operations data (ops-mcp)",
    }),
  );

  const auth = requireBearerAuth({
    verifier: opts.verifier,
    requiredScopes: [],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(opts.resourceUrl),
    expectedResource: opts.resourceUrl,
  });

  const path = opts.resourceUrl.pathname;

  // Stateless Streamable HTTP: one server per request, built from that request's verified token.
  app.post(path, auth, async (req: Request, res: Response) => {
    const info = req.auth!;
    const who = principal(String(info.extra?.sub ?? "unknown"), info.clientId, info.scopes);
    const server = createOpsServer({ principal: who, audit: opts.audit, data: opts.data });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null });
    }
  });

  const notAllowed = (_req: Request, res: Response) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  };
  app.get(path, auth, notAllowed);
  app.delete(path, auth, notAllowed);

  return app;
}

async function main(): Promise<void> {
  const port = Number(process.env.PORT ?? 3333);
  const resourceUrl = new URL(process.env.OPS_MCP_RESOURCE_URL ?? `http://localhost:${port}/mcp`);
  const audit = new FileAuditSink(process.env.OPS_MCP_AUDIT_LOG ?? "audit/http.jsonl");

  let verifier: OAuthTokenVerifier;
  let authServer: OAuthMetadata;
  const issuer = process.env.OPS_MCP_ISSUER;
  const devSecret = process.env.OPS_MCP_DEV_SECRET;

  if (issuer) {
    // Real identity provider: read its metadata and verify tokens against its published keys.
    const metaUrl = new URL("/.well-known/oauth-authorization-server", issuer);
    const meta = (await (await fetch(metaUrl)).json()) as OAuthMetadata & { jwks_uri?: string };
    const jwksUri = process.env.OPS_MCP_JWKS_URL ?? meta.jwks_uri;
    if (!jwksUri) throw new Error("No jwks_uri in the issuer metadata; set OPS_MCP_JWKS_URL");
    verifier = new JwtVerifier({ issuer, audience: resourceUrl.href, key: jwksKey(jwksUri), onReject: (r) => console.error(`token rejected: ${r}`) });
    authServer = meta;
  } else if (devSecret) {
    // Local development only: HS256 tokens minted by `npm run dev-token`. Refuse to do this off localhost.
    if (!["localhost", "127.0.0.1"].includes(resourceUrl.hostname)) throw new Error("OPS_MCP_DEV_SECRET is for localhost only");
    const devIssuer = `http://localhost:${port}/dev-issuer`;
    verifier = new JwtVerifier({ issuer: devIssuer, audience: resourceUrl.href, key: new TextEncoder().encode(devSecret), algorithms: ["HS256"] });
    authServer = {
      issuer: devIssuer,
      authorization_endpoint: `${devIssuer}/authorize`,
      token_endpoint: `${devIssuer}/token`,
      response_types_supported: ["code"],
    };
    console.error("DEV MODE: accepting HS256 tokens from `npm run dev-token`. Not for real data.");
  } else {
    throw new Error("Set OPS_MCP_ISSUER (real IdP) or OPS_MCP_DEV_SECRET (local dev)");
  }

  createHttpApp({ resourceUrl, verifier, authServer, audit }).listen(port, "127.0.0.1", () => {
    console.error(`ops-mcp listening on ${resourceUrl.href}`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
