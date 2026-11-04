/**
 * Source operational state: request budgets, rate-limit awareness and circuit breaker
 * (Sections 20.3, 31.2). All state is persisted so a worker restart cannot flood a source.
 */
import type { Db } from "@buytrail/db";
import { sourceCapabilitiesSchema, type SourceCapabilities } from "@buytrail/providers";

export const CIRCUIT_OPEN_AFTER_FAILURES = 5;
export const CIRCUIT_OPEN_MS = 10 * 60_000;

export type BudgetDecision = { ok: true } | { ok: false; reason: "circuit_open" | "rate_limited" | "budget_exhausted" | "disabled"; retryAt: Date };

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Reserve one request from the source's daily budget, honouring persisted Retry-After. */
export async function reserveSourceRequest(db: Db, sourceId: string, now: Date): Promise<BudgetDecision> {
  const s = await db.source.findUniqueOrThrow({ where: { id: sourceId } });
  if (s.status === "disabled") return { ok: false, reason: "disabled", retryAt: new Date(now.getTime() + 3600_000) };
  if (s.nextEligibleRequestAt && s.nextEligibleRequestAt > now) {
    return { ok: false, reason: s.status === "circuit_open" ? "circuit_open" : "rate_limited", retryAt: s.nextEligibleRequestAt };
  }
  const day = utcDay(now);
  // Atomic conditional increment: never exceed the budget even with concurrent workers.
  const rows = await db.$queryRaw<Array<{ used: number }>>`
    INSERT INTO source_budget_day ("sourceId", "day", "used") VALUES (${sourceId}, ${day}, 1)
    ON CONFLICT ("sourceId", "day") DO UPDATE SET "used" = source_budget_day."used" + 1
      WHERE source_budget_day."used" < ${s.dailyRequestBudget}
    RETURNING "used"`;
  if (rows.length === 0 || s.dailyRequestBudget === 0) {
    const tomorrow = new Date(`${day}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { ok: false, reason: "budget_exhausted", retryAt: tomorrow };
  }
  return { ok: true };
}

export async function recordSourceSuccess(db: Db, sourceId: string, now: Date): Promise<void> {
  await db.source.update({
    where: { id: sourceId },
    data: { consecutiveFailures: 0, lastSuccessAt: now, status: "enabled", nextEligibleRequestAt: null },
  });
}

/** Record a failure; 429 Retry-After is persisted; repeated failures open the circuit. */
export async function recordSourceFailure(db: Db, sourceId: string, now: Date, code: string, retryAfterMs: number | null): Promise<void> {
  const s = await db.source.update({
    where: { id: sourceId },
    data: { consecutiveFailures: { increment: 1 }, lastFailureAt: now, lastFailureCode: code },
  });
  let next: Date | null = retryAfterMs ? new Date(now.getTime() + retryAfterMs) : null;
  let status = s.status === "disabled" ? "disabled" : "degraded";
  if (s.consecutiveFailures >= CIRCUIT_OPEN_AFTER_FAILURES) {
    status = "circuit_open";
    const open = new Date(now.getTime() + CIRCUIT_OPEN_MS);
    if (!next || open > next) next = open;
  }
  await db.source.update({ where: { id: sourceId }, data: { status, nextEligibleRequestAt: next } });
}

export function parseCapabilities(json: unknown): SourceCapabilities {
  return sourceCapabilitiesSchema.parse(json);
}

export async function sourceHealth(db: Db, now: Date) {
  const sources = await db.source.findMany({ orderBy: { id: "asc" } });
  const day = utcDay(now);
  const budgets = await db.sourceBudgetDay.findMany({ where: { day } });
  const counts = await db.sourceListing.groupBy({ by: ["sourceId", "matchStatus"], _count: { _all: true } });
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    mode: s.mode,
    status: s.status,
    approvalStatus: s.approvalStatus,
    capabilities: parseCapabilities(s.capabilities),
    freshnessSeconds: s.freshnessSeconds,
    historyRetentionDays: s.historyRetentionDays,
    dailyRequestBudget: s.dailyRequestBudget,
    usedToday: budgets.find((b) => b.sourceId === s.id)?.used ?? 0,
    consecutiveFailures: s.consecutiveFailures,
    lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: s.lastFailureAt?.toISOString() ?? null,
    lastFailureCode: s.lastFailureCode,
    nextEligibleRequestAt: s.nextEligibleRequestAt?.toISOString() ?? null,
    listingsByMatchStatus: Object.fromEntries(counts.filter((c) => c.sourceId === s.id).map((c) => [c.matchStatus, c._count._all])),
  }));
}
