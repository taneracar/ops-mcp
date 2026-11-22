import { describe, expect, it } from "vitest";
import { canSee, clearance, principal, REDACTED, redact, SCOPES } from "../src/policy.js";

const p = (...scopes: string[]) => principal("u", "c", scopes);

describe("clearance", () => {
  it("is cumulative: each level needs every scope below it", () => {
    expect(clearance(p())).toBe("public");
    expect(clearance(p(SCOPES.read))).toBe("internal");
    expect(clearance(p(SCOPES.read, SCOPES.finance))).toBe("confidential");
    expect(clearance(p(SCOPES.read, SCOPES.finance, SCOPES.restricted))).toBe("restricted");
  });

  it("does not skip a missing level", () => {
    expect(clearance(p(SCOPES.finance))).toBe("public");
    expect(clearance(p(SCOPES.read, SCOPES.restricted))).toBe("internal");
  });
});

describe("canSee", () => {
  it("needs ops:pii for personal fields on top of the level", () => {
    const rule = { level: "internal" as const, pii: true };
    expect(canSee(p(SCOPES.read), rule)).toBe(false);
    expect(canSee(p(SCOPES.read, SCOPES.pii), rule)).toBe(true);
    expect(canSee(p(SCOPES.pii), rule)).toBe(false);
  });
});

describe("redact", () => {
  it("hides fields the caller may not see and reports them", () => {
    const r = redact(p(SCOPES.read), { id: "1", salary: 10, email: "a@b.c" }, {
      id: { level: "internal" },
      salary: { level: "confidential" },
      email: { level: "internal", pii: true },
    });
    expect(r.row).toEqual({ id: "1", salary: REDACTED, email: REDACTED });
    expect(r.hidden.sort()).toEqual(["email", "salary"]);
    expect(r.level).toBe("internal");
  });

  it("denies by default: a field with no rule is hidden even from a fully cleared caller", () => {
    const all = p(SCOPES.read, SCOPES.finance, SCOPES.pii, SCOPES.restricted);
    const r = redact(all, { id: "1", ssn: "123" } as Record<string, string>, { id: { level: "internal" } });
    expect(r.row.ssn).toBe(REDACTED);
    expect(r.hidden).toEqual(["ssn"]);
  });

  it("reports the highest level actually returned", () => {
    const r = redact(p(SCOPES.read, SCOPES.finance), { a: 1, b: 2 }, { a: { level: "internal" }, b: { level: "confidential" } });
    expect(r.level).toBe("confidential");
  });
});
