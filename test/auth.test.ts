import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { JwtVerifier, scopesFrom } from "../src/auth.js";

const secret = new TextEncoder().encode("x".repeat(32));
const AUD = "http://localhost:3333/mcp";
const ISS = "http://localhost:3333/dev-issuer";
const verifier = (onReject?: (r: string) => void) => new JwtVerifier({ issuer: ISS, audience: AUD, key: secret, algorithms: ["HS256"], onReject });

const sign = (claims: Record<string, unknown>, aud: string | string[] = AUD) =>
  new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).setSubject("erin").setIssuer(ISS).setAudience(aud).setExpirationTime("5m").sign(secret);

describe("JwtVerifier", () => {
  it("maps claims to AuthInfo, taking the resource from the token's audience", async () => {
    const info = await verifier().verifyAccessToken(await sign({ scope: "ops:read ops:finance", azp: "web-app" }, ["https://other.example/api", AUD]));
    expect(info).toMatchObject({ clientId: "web-app", scopes: ["ops:read", "ops:finance"], extra: { sub: "erin" } });
    expect(info.resource?.href).toBe(AUD);
  });

  it("reports the reason server-side only", async () => {
    const reasons: string[] = [];
    const t = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject("erin").setIssuer(ISS).setAudience(AUD).setExpirationTime(Math.floor(Date.now() / 1000) - 600).sign(secret);
    await expect(verifier((r) => reasons.push(r)).verifyAccessToken(t)).rejects.toThrow(/^Invalid access token$/);
    expect(reasons).toEqual(["ERR_JWT_EXPIRED"]);
  });

  it("refuses a token with no subject", async () => {
    const t = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuer(ISS).setAudience(AUD).setExpirationTime("5m").sign(secret);
    await expect(verifier().verifyAccessToken(t)).rejects.toThrow();
  });

  it("refuses an algorithm it was not configured for", async () => {
    const strict = new JwtVerifier({ issuer: ISS, audience: AUD, key: secret }); // asymmetric algorithms only
    await expect(strict.verifyAccessToken(await sign({}))).rejects.toThrow();
  });
});

describe("scopesFrom", () => {
  it("reads OAuth `scope` strings and Entra-style `scp` arrays", () => {
    expect(scopesFrom({ scope: " ops:read  ops:pii " })).toEqual(["ops:read", "ops:pii"]);
    expect(scopesFrom({ scp: ["ops:read", 3] })).toEqual(["ops:read"]);
    expect(scopesFrom({})).toEqual([]);
  });
});
