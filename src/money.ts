/** Parses "1,234.5", "$1,234.56", "-12", "(12.00)" into integer cents without going through floats. */
export function parseMoneyToCents(raw: string): number {
  let s = raw.trim();
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1).trim();
  }
  s = s.replace(/^\$/, "").replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`not a money amount: ${JSON.stringify(raw)}`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`amount too large: ${raw}`);
  return negative ? -cents : cents;
}

/** Hours with up to two decimals, returned in hundredths so the rate product stays an integer. */
export function parseHoursToHundredths(raw: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) throw new Error(`not an hour amount: ${JSON.stringify(raw)}`);
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** hours × rate, rounded half-up to the cent, computed in integers. */
export function lineAmountCents(hoursHundredths: number, rateCents: number): number {
  const product = BigInt(hoursHundredths) * BigInt(rateCents); // in hundredths of a cent
  const q = product / 100n;
  const r = product % 100n;
  return Number(r >= 50n ? q + 1n : q);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
