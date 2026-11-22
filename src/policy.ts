// Access policy: who may call which tool, and which fields they may see.
//
// Two independent axes, because "how sensitive is this" and "is this about a person" are different questions:
//   - classification level: public < internal < confidential < restricted
//   - pii: personal data (email, salary attached to a name) that needs its own grant
//
// Scopes come from the OAuth access token (HTTP) or a local dev setting (stdio).

export const LEVELS = ["public", "internal", "confidential", "restricted"] as const;
export type Level = (typeof LEVELS)[number];

export const SCOPES = {
  read: "ops:read", // internal operational data
  finance: "ops:finance", // confidential: costs, salaries in aggregate, budgets
  pii: "ops:pii", // personal data about named people
  restricted: "ops:restricted", // unannounced plans (org changes, headcount cuts)
} as const;
export type Scope = (typeof SCOPES)[keyof typeof SCOPES];
export const ALL_SCOPES: Scope[] = Object.values(SCOPES);

export type Principal = {
  subject: string; // who is asking (user id / token sub)
  clientId: string; // which app is asking on their behalf
  scopes: ReadonlySet<string>;
};

export type FieldRule = { level: Level; pii?: boolean };
export type FieldPolicy<T> = { [K in keyof T]-?: FieldRule };

const scopeForLevel: Record<Level, Scope | null> = {
  public: null,
  internal: SCOPES.read,
  confidential: SCOPES.finance,
  restricted: SCOPES.restricted,
};

/** Highest level this principal is cleared for. Levels are cumulative only if every lower scope is held too. */
export function clearance(p: Principal): Level {
  let cleared: Level = "public";
  for (const level of LEVELS) {
    const needed = scopeForLevel[level];
    if (needed === null || p.scopes.has(needed)) cleared = level;
    else break;
  }
  return cleared;
}

export function rank(level: Level): number {
  return LEVELS.indexOf(level);
}

export function canSee(p: Principal, rule: FieldRule): boolean {
  if (rank(rule.level) > rank(clearance(p))) return false;
  if (rule.pii && !p.scopes.has(SCOPES.pii)) return false;
  return true;
}

export const REDACTED = "[redacted]";

export type Redacted<T> = { [K in keyof T]: T[K] | typeof REDACTED };

/**
 * Returns a copy of `row` with every field the principal may not see replaced by "[redacted]",
 * and the names of the fields that were hidden. Fields missing from the policy are hidden too
 * (deny by default), so adding a column to the data never leaks it by accident.
 */
export function redact<T extends Record<string, unknown>>(
  p: Principal,
  row: T,
  policy: Partial<FieldPolicy<T>>,
): { row: Redacted<T>; hidden: string[]; level: Level } {
  const out: Record<string, unknown> = {};
  const hidden: string[] = [];
  let level: Level = "public";
  for (const [key, value] of Object.entries(row)) {
    const rule = policy[key as keyof T];
    if (rule && canSee(p, rule)) {
      out[key] = value;
      if (rank(rule.level) > rank(level)) level = rule.level;
    } else {
      out[key] = REDACTED;
      hidden.push(key);
    }
  }
  return { row: out as Redacted<T>, hidden, level };
}

export class AccessDenied extends Error {
  constructor(
    readonly tool: string,
    readonly missing: string[],
  ) {
    super(`Access denied for ${tool}: missing scope ${missing.join(", ")}`);
  }
}

export function requireScopes(p: Principal, tool: string, needed: readonly string[]): void {
  const missing = needed.filter((s) => !p.scopes.has(s));
  if (missing.length > 0) throw new AccessDenied(tool, missing);
}

export function principal(subject: string, clientId: string, scopes: Iterable<string>): Principal {
  return { subject, clientId, scopes: new Set(scopes) };
}

export function maxLevel(levels: Iterable<Level>, floor: Level = "public"): Level {
  let m = floor;
  for (const l of levels) if (rank(l) > rank(m)) m = l;
  return m;
}
