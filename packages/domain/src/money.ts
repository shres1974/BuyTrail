/**
 * Exact integer money (Section 13.1). Amounts are bigint minor units; JSON uses
 * decimal integer strings. Floating point is never used for arithmetic.
 */

export type Currency = "CAD" | "USD";
export const SUPPORTED_RANKING_CURRENCY: Currency = "CAD";

export type Money = { amountMinor: bigint; currency: Currency };
export type MoneyJSON = { amountMinor: string; currency: Currency };

/** Upper bound per field: 1,000,000,000,000 minor units (CAD 10 billion). */
export const MAX_MINOR = 1_000_000_000_000n;
/** Sums (e.g. item + shipping + fees) may reach a few fields' worth. */
export const MAX_SUM_MINOR = MAX_MINOR * 4n;

export class MoneyError extends Error {}

const MINOR_RE = /^(0|[1-9][0-9]{0,15})$/;

/** Parse a validated non-negative decimal integer string of minor units. */
export function parseMinor(s: string): bigint {
  if (typeof s !== "string" || !MINOR_RE.test(s)) {
    throw new MoneyError(`Invalid minor-unit amount: ${JSON.stringify(s)}`);
  }
  const v = BigInt(s);
  if (v > MAX_MINOR) throw new MoneyError("Amount exceeds the supported maximum");
  return v;
}

/** Parse a user-entered major amount like "199.99" or "205" (no signs, ≤2 decimals). */
export function parseMajor(s: string): bigint {
  const t = s.trim().replace(/^CAD\s*/i, "").replace(/^\$/, "").replace(/,/g, "");
  const m = /^(0|[1-9][0-9]{0,13})(?:\.([0-9]{1,2}))?$/.exec(t);
  if (!m) throw new MoneyError(`Invalid amount: ${JSON.stringify(s)}`);
  const whole = BigInt(m[1]!);
  const frac = BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  const v = whole * 100n + frac;
  if (v > MAX_MINOR) throw new MoneyError("Amount exceeds the supported maximum");
  return v;
}

export function money(amountMinor: bigint | string | number, currency: Currency = "CAD"): Money {
  let v: bigint;
  if (typeof amountMinor === "bigint") v = amountMinor;
  else if (typeof amountMinor === "number") {
    if (!Number.isSafeInteger(amountMinor)) throw new MoneyError("Non-integer minor units");
    v = BigInt(amountMinor);
  } else v = parseMinor(amountMinor);
  if (v < 0n) throw new MoneyError("Negative amounts are not allowed");
  if (v > MAX_MINOR) throw new MoneyError("Amount exceeds the supported maximum");
  return { amountMinor: v, currency };
}

export function addMoney(...parts: Money[]): Money {
  if (parts.length === 0) throw new MoneyError("Nothing to add");
  const cur = parts[0]!.currency;
  let sum = 0n;
  for (const p of parts) {
    if (p.currency !== cur) throw new MoneyError("Currency mismatch");
    sum += p.amountMinor;
  }
  if (sum > MAX_SUM_MINOR) throw new MoneyError("Sum exceeds the supported bound");
  return { amountMinor: sum, currency: cur };
}

export function subtractMoney(a: Money, b: Money): bigint {
  if (a.currency !== b.currency) throw new MoneyError("Currency mismatch");
  return a.amountMinor - b.amountMinor;
}

export function compareMoney(a: Money, b: Money): -1 | 0 | 1 {
  if (a.currency !== b.currency) throw new MoneyError("Currency mismatch");
  return a.amountMinor < b.amountMinor ? -1 : a.amountMinor > b.amountMinor ? 1 : 0;
}

export function toJSON(m: Money): MoneyJSON {
  return { amountMinor: m.amountMinor.toString(), currency: m.currency };
}

export function fromJSON(j: MoneyJSON): Money {
  return money(parseMinor(j.amountMinor), j.currency);
}

/** Display formatting happens only at the boundary. */
export function formatMoney(m: Money | { amountMinor: bigint | string; currency: string }): string {
  const v = typeof m.amountMinor === "string" ? BigInt(m.amountMinor) : m.amountMinor;
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${m.currency} ${whole}.${frac}`;
}

/** ceil(numerator/denominator) for non-negative bigints. */
export function ceilDiv(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new MoneyError("ceilDiv expects non-negative numerator and positive divisor");
  return (n + d - 1n) / d;
}
