import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// One line per tool call. Argument values are never written: they can contain names or other
// personal data, and the audit log is read by more people than the data itself. A SHA-256 digest
// lets an investigator match a call to a known input without the log holding it.

export type AuditEvent = {
  ts: string;
  subject: string;
  clientId: string;
  tool: string;
  argsDigest: string;
  decision: "allowed" | "denied" | "error";
  hiddenFields: string[];
  rows: number;
  detail?: string;
};

export interface AuditSink {
  write(event: AuditEvent): void;
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
  }
  write(event: AuditEvent): void {
    appendFileSync(this.path, JSON.stringify(event) + "\n", { encoding: "utf8", mode: 0o600 });
  }
}

/** Stable digest: keys sorted, so {a,b} and {b,a} hash the same. */
export function digestArgs(args: unknown): string {
  return "sha256:" + createHash("sha256").update(stableStringify(args ?? {})).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
