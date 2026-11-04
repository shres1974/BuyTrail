/**
 * Freshness, effective expiry and anomaly heuristics (Section 15).
 */
import { Money } from "./money";

export type FreshnessPolicy = {
  /** Application freshness boundary measured from the most conservative observation time. */
  maxAgeSeconds: number;
  /** Source-imposed retention for current display, if any. */
  retentionSeconds?: number | null;
};

/**
 * Effective expiry = earliest of: provider validUntil; observation time + maxAge, where
 * observation time is the source-observed time when known (not our re-fetch time);
 * fetch time + retention restriction.
 */
export function effectiveExpiry(input: {
  fetchedAt: Date;
  sourceObservedAt: Date | null;
  validUntil: Date | null;
  policy: FreshnessPolicy;
}): Date {
  const { fetchedAt, sourceObservedAt, validUntil, policy } = input;
  // Never let a source-observed time "in the future" extend freshness.
  const basis = sourceObservedAt && sourceObservedAt < fetchedAt ? sourceObservedAt : fetchedAt;
  const candidates = [basis.getTime() + policy.maxAgeSeconds * 1000];
  if (validUntil) candidates.push(validUntil.getTime());
  if (policy.retentionSeconds != null) candidates.push(fetchedAt.getTime() + policy.retentionSeconds * 1000);
  return new Date(Math.min(...candidates));
}

export type FreshnessStatus = "fresh" | "stale" | "never_checked";

export function freshnessStatus(expiresAt: Date | null, now: Date): FreshnessStatus {
  if (!expiresAt) return "never_checked";
  return expiresAt.getTime() > now.getTime() ? "fresh" : "stale";
}

/** Human-friendly relative age: "Checked 2 hours ago". */
export function relativeAge(then: Date, now: Date): string {
  const s = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export type AnomalyPolicy = {
  /** Flag when the new price is at or below this fraction of the previous accepted price. */
  dropFractionBps: number; // e.g. 4000 = 40% of previous (a 60% drop)
  /** Flag when the new price is at or above this multiple of the previous, in bps. */
  riseFractionBps: number; // e.g. 50000 = 5x
};

export const DEFAULT_ANOMALY_POLICY: AnomalyPolicy = { dropFractionBps: 4000, riseFractionBps: 50000 };

export type AnomalyCheck = { suspicious: false } | { suspicious: true; reason: string };

/** Heuristic only, not proof of fraud (Section 15.1). */
export function checkPriceAnomaly(previous: Money | null, next: Money | null, policy = DEFAULT_ANOMALY_POLICY): AnomalyCheck {
  if (!previous || !next) return { suspicious: false };
  if (previous.currency !== next.currency) return { suspicious: true, reason: "currency_changed" };
  if (previous.amountMinor === 0n) return { suspicious: false };
  const ratioBps = (next.amountMinor * 10000n) / previous.amountMinor;
  if (ratioBps <= BigInt(policy.dropFractionBps)) {
    return { suspicious: true, reason: `price_drop_to_${ratioBps}bps_of_previous` };
  }
  if (ratioBps >= BigInt(policy.riseFractionBps)) {
    return { suspicious: true, reason: `price_rise_to_${ratioBps}bps_of_previous` };
  }
  return { suspicious: false };
}

/** History coverage label (G25): never claim a longer window than retained data covers. */
export function historyCoverageLabel(firstObservedAt: Date | null, windowDays: number, now: Date, fmtDate: (d: Date) => string): string | null {
  if (!firstObservedAt) return null;
  const windowStart = now.getTime() - windowDays * 86400_000;
  if (firstObservedAt.getTime() <= windowStart) return `Lowest observed in the last ${windowDays} days`;
  return `Lowest observed since ${fmtDate(firstObservedAt)}`;
}
