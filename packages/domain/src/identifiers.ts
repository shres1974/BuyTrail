/**
 * Product identifier normalization (Section 12.2). Identifiers are strings; leading
 * zeros are preserved in a canonical GTIN-14 form, never stripped and compared as numbers.
 */

export type IdentifierKind = "gtin" | "mpn";

export type NormalizedIdentifier =
  | { ok: true; kind: IdentifierKind; original: string; normalized: string }
  | { ok: false; kind: IdentifierKind; original: string; reason: string };

/** GS1 mod-10 check digit validation for GTIN-8/12/13/14. */
export function gtinCheckDigitValid(digits: string): boolean {
  if (!/^[0-9]+$/.test(digits)) return false;
  const body = digits.slice(0, -1);
  const check = Number(digits.at(-1));
  let sum = 0;
  // Weights alternate 3,1 starting from the rightmost body digit.
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === check;
}

/** Compute a check digit for a GTIN body (used by fixtures). */
export function gtinCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const d = Number(body[body.length - 1 - i]);
    sum += d * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

export function normalizeGtin(raw: string): NormalizedIdentifier {
  const original = raw;
  const digits = raw.replace(/[\s-]/g, "");
  if (!/^[0-9]+$/.test(digits)) return { ok: false, kind: "gtin", original, reason: "non_numeric" };
  if (![8, 12, 13, 14].includes(digits.length)) {
    return { ok: false, kind: "gtin", original, reason: "invalid_length" };
  }
  if (!gtinCheckDigitValid(digits)) return { ok: false, kind: "gtin", original, reason: "bad_check_digit" };
  // Left-pad to GTIN-14: this is the GS1 canonical form; it adds, never removes, zeros.
  return { ok: true, kind: "gtin", original, normalized: digits.padStart(14, "0") };
}

/** MPN/model normalization for matching: case-folded, separators removed. */
export function normalizeMpn(raw: string): NormalizedIdentifier {
  const original = raw;
  const n = raw.trim().toUpperCase().replace(/[\s\-_./]/g, "");
  if (n.length < 3 || n.length > 64 || !/^[A-Z0-9]+$/.test(n)) {
    return { ok: false, kind: "mpn", original, reason: "invalid_format" };
  }
  return { ok: true, kind: "mpn", original, normalized: n };
}

export function normalizeIdentifier(kind: IdentifierKind, raw: string): NormalizedIdentifier {
  return kind === "gtin" ? normalizeGtin(raw) : normalizeMpn(raw);
}

export const normalizeModel = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const r = normalizeMpn(raw);
  return r.ok ? r.normalized : null;
};
