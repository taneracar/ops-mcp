// DEV ONLY: mints an HS256 access token for the local HTTP server started with OPS_MCP_DEV_SECRET.
// Usage: OPS_MCP_DEV_SECRET=... npm run dev-token -- --scopes "ops:read ops:finance" [--sub alice] [--port 3333]
import { SignJWT } from "jose";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const secret = process.env.OPS_MCP_DEV_SECRET;
if (!secret || secret.length < 32) {
  console.error("Set OPS_MCP_DEV_SECRET (at least 32 characters) to the same value the server uses.");
  process.exit(1);
}
const port = arg("port", process.env.PORT ?? "3333");
const token = await new SignJWT({ scope: arg("scopes", "ops:read"), client_id: "dev-cli" })
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(arg("sub", "dev-user"))
  .setIssuer(`http://localhost:${port}/dev-issuer`)
  .setAudience(`http://localhost:${port}/mcp`)
  .setIssuedAt()
  .setExpirationTime(arg("ttl", "1h"))
  .sign(new TextEncoder().encode(secret));
process.stdout.write(token + "\n");
