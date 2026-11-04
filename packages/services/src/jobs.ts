/**
 * Job handlers shared by the worker (and tests). Each handler is idempotent: running twice, or
 * crashing after an external side effect, is safe (Section 20.2).
 */
import type { Db } from "@buytrail/db";
import { backoffMs } from "@buytrail/domain";
import type { Services } from "./context";
import { buildExport, completeAccountDeletion } from "./account";
import { dispatchDelivery } from "./notifications";
import { claimOutbox, completeOutbox, failOutbox, type OutboxPayloads, type OutboxType } from "./outbox";
import { validateReceipt } from "./receipts";
import { refreshListing } from "./ingestion";
import { evaluateWatchesFor } from "./watches";

export async function handleOutbox(s: Services, outboxId: string): Promise<string> {
  const claimed = await claimOutbox(s.db, s.clock, outboxId);
  if (!claimed) return "not_claimed";
  try {
    const result = await runHandler(s, claimed.type, claimed.payload as never);
    await completeOutbox(s.db, s.clock, claimed.id);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.log.error("outbox handler failed", { outboxId, type: claimed.type, attempt: claimed.attempts, error: msg });
    await failOutbox(s.db, claimed.id, msg, new Date(s.clock.now().getTime() + backoffMs(claimed.attempts, { baseMs: 5_000, maxMs: 30 * 60_000 })));
    return "failed";
  }
}

async function runHandler<T extends OutboxType>(s: Services, type: T, payload: OutboxPayloads[T]): Promise<string> {
  const now = s.clock.now();
  switch (type) {
    case "watch.evaluate_variant": {
      const p = payload as OutboxPayloads["watch.evaluate_variant"];
      const r = await evaluateWatchesFor(s.db, s.config, now, p.variantId, p.contextId);
      return `evaluated:${r.evaluated}:events:${r.events}`;
    }
    case "notification.dispatch":
      return dispatchDelivery(s.db, s.config, s.clock, s.mailer, (payload as OutboxPayloads["notification.dispatch"]).deliveryId);
    case "refresh.listing": {
      const p = payload as OutboxPayloads["refresh.listing"];
      const r = await refreshListing(s.db, s.clock, s.providers, p.listingId, p.contextId, { verification: p.reason === "verify_anomaly" });
      if (r.kind === "skipped" && r.retryAt && ["rate_limited", "budget_exhausted", "circuit_open"].includes(r.reason)) {
        // Respect the source's delay rather than retrying immediately.
        throw new RetryLater(r.reason, r.retryAt);
      }
      return r.kind;
    }
    case "receipt.validate":
      return validateReceipt(s.db, s.config, s.storage, (payload as OutboxPayloads["receipt.validate"]).receiptId, now);
    case "account.delete":
      return completeAccountDeletion(s.db, now, (payload as OutboxPayloads["account.delete"]).userId);
    case "account.export":
      return buildExport(s.db, s.storage, now, (payload as OutboxPayloads["account.export"]).exportId, s.config.RECEIPT_MAX_BYTES);
    default:
      return "unknown_type";
  }
}

export class RetryLater extends Error {
  constructor(
    reason: string,
    public readonly at: Date,
  ) {
    super(`retry later: ${reason}`);
  }
}

/** Scheduled refresh: pick due (listing, context) pairs; one check serves all watches on it. */
export async function scheduleDueRefreshes(db: Db, now: Date, limit = 100): Promise<number> {
  const due = await db.refreshSchedule.findMany({ where: { dueAt: { lte: now } }, orderBy: [{ priority: "desc" }, { dueAt: "asc" }], take: limit });
  for (const d of due) {
    await db.$transaction([
      db.refreshSchedule.update({ where: { listingId_contextId: { listingId: d.listingId, contextId: d.contextId } }, data: { dueAt: new Date(now.getTime() + d.intervalSeconds * 1000) } }),
      db.outboxEvent.create({ data: { type: "refresh.listing", entityKey: `${d.listingId}:${d.contextId}:sched`, payload: { listingId: d.listingId, contextId: d.contextId, reason: "scheduled" }, availableAt: now, createdAt: now } }),
    ]);
  }
  return due.length;
}

/**
 * Maintain refresh schedules: watched listing/contexts refresh every `watchedSeconds`, others
 * every `idleSeconds`. Bounded by the source's minimum refresh interval.
 */
export async function syncRefreshSchedules(db: Db, now: Date, opts: { watchedSeconds: number; idleSeconds: number }) {
  const listings = await db.sourceListing.findMany({ where: { removedAt: null }, select: { id: true, variantId: true, source: { select: { capabilities: true } } } });
  const watched = new Set((await db.watch.findMany({ where: { lifecycle: "active" }, select: { variantId: true, contextId: true } })).map((w) => `${w.variantId}|${w.contextId}`));
  const contexts = await db.quoteContext.findMany({ where: { ownerUserId: null }, select: { id: true } });
  let n = 0;
  for (const l of listings) {
    const minSec = (l.source.capabilities as { minimumRefreshSeconds?: number }).minimumRefreshSeconds ?? 60;
    for (const c of contexts) {
      const isWatched = l.variantId !== null && watched.has(`${l.variantId}|${c.id}`);
      const interval = Math.max(minSec, isWatched ? opts.watchedSeconds : opts.idleSeconds);
      await db.refreshSchedule.upsert({
        where: { listingId_contextId: { listingId: l.id, contextId: c.id } },
        create: { listingId: l.id, contextId: c.id, dueAt: new Date(now.getTime() + interval * 1000), intervalSeconds: interval, priority: isWatched ? 10 : 0 },
        update: { intervalSeconds: interval, priority: isWatched ? 10 : 0 },
      });
      n++;
    }
  }
  return n;
}
