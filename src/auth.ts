import type { OAuthTokenVerifier } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import { InvalidTokenError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createRemoteJWKSet, errors as joseErrors, type JWTPayload, jwtVerify, type JWTVerifyGetKey } from "jose";

// This server is an OAuth 2.1 *resource server*: it does not log anyone in. An identity provider
// (Entra ID, Okta, Auth0, Keycloak, ...) issues JWT access tokens; this verifier checks signature,
// issuer, audience (the token must be minted for this server, RFC 8707) and expiry, then reads scopes.

export type JwtVerifierOptions = {
  issuer: string;
  /** The MCP server's own URL; tokens must carry it in `aud`. */
  audience: string;
  /** Key source: a JWKS URL for a real IdP, or a key/getter in tests and dev. */
  key: JWTVerifyGetKey | CryptoKey | Uint8Array;
  algorithms?: string[];
  clockToleranceSec?: number;
  /** Called with the rejection reason (e.g. ERR_JWT_EXPIRED) for server-side logs. */
  onReject?: (reason: string) => void;
};

export function jwksKey(jwksUrl: string): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(jwksUrl), { cooldownDuration: 30_000, timeoutDuration: 5_000 });
}

/** Scopes may arrive as an OAuth `scope` string or an Entra-style `scp` string/array. */
export function scopesFrom(payload: JWTPayload): string[] {
  const raw = payload.scope ?? payload.scp;
  if (typeof raw === "string") return raw.split(/\s+/).filter(Boolean);
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === "string");
  return [];
}

export class JwtVerifier implements OAuthTokenVerifier {
  constructor(private readonly opts: JwtVerifierOptions) {}

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    let payload: JWTPayload;
    try {
      const verifyOpts = {
        issuer: this.opts.issuer,
        audience: this.opts.audience,
        algorithms: this.opts.algorithms ?? ["RS256", "ES256", "PS256", "EdDSA"],
        clockTolerance: this.opts.clockToleranceSec ?? 30,
        requiredClaims: ["sub", "exp"],
      };
      const key = this.opts.key;
      payload =
        typeof key === "function"
          ? (await jwtVerify(token, key, verifyOpts)).payload
          : (await jwtVerify(token, key as CryptoKey | Uint8Array, verifyOpts)).payload;
    } catch (e) {
      // One generic message to the client: telling a caller *why* a token failed (bad signature vs.
      // wrong audience vs. expired) helps someone probing with forged tokens. The reason goes to
      // the optional server-side hook instead.
      this.opts.onReject?.(e instanceof joseErrors.JOSEError ? e.code : "ERR_UNKNOWN");
      throw new InvalidTokenError("Invalid access token");
    }
    const clientId = (payload.client_id ?? payload.azp ?? payload.appid) as string | undefined;
    return {
      token,
      clientId: clientId ?? "unknown-client",
      scopes: scopesFrom(payload),
      expiresAt: payload.exp,
      // Taken from the token itself, so the SDK middleware's own audience check is a second,
      // independent layer on top of jwtVerify's: either one alone refuses a token for another server.
      resource: resourceFrom(payload.aud, this.opts.audience),
      extra: { sub: payload.sub },
    };
  }
}

function resourceFrom(aud: JWTPayload["aud"], expected: string): URL | undefined {
  const list = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [];
  const pick = list.find((a) => a === expected) ?? list[0];
  try {
    return pick ? new URL(pick) : undefined;
  } catch {
    return undefined;
  }
}
