/**
 * Transactional outbox (Section 20.1). Work intent is written in the same transaction as the
 * state change that causes it. A relay publishes due rows; a handler claims a row with a lease,
 * executes, and records completion. A reconciler republishes rows whose queue entry was lost or
 * whose lease expired, so Redis can be cleared without forgetting committed work (G17).
 */
import type { Db, Tx } from "@buytrail/db";
import type { Clock } from "@buytrail/domain";

export type OutboxType =
  | "watch.evaluate_variant"
  | "notification.dispatch"
  | "refresh.listing"
  | "receipt.validate"
  | "account.delete"
  | "account.export"
  | "object.delete";

export type OutboxPayloads = {
  "watch.evaluate_variant": { variantId: string; contextId: string };
  "notification.dispatch": { deliveryId: string };
  "refresh.listing": { listingId: string; contextId: string; reason: string };
  "receipt.validate": { receiptId: string };
  "account.delete": { userId: string };
  "account.export": { exportId: string };
  "object.delete": { taskId: string };
};

export async function enqueueOutbox<T extends OutboxType>(
  tx: Tx | Db,
  type: T,
  entityKey: string,
  payload: OutboxPayloads[T],
  /** Required: callers pass the injected clock's time (never the wall clock). */
  availableAt: Date,
): Promise<string> {
  const row = await tx.outboxEvent.create({
    data: { type, entityKey, payload: payload as object, availableAt, createdAt: availableAt },
    select: { id: true },
  });
  return row.id;
}

export type Publisher = (job: { name: OutboxType; outboxId: string; jobId: string }) => Promise<void>;

export const OUTBOX_LEASE_MS = 2 * 60_000;
/** A dispatched row with no claim after this long is assumed lost from the queue. */
export const OUTBOX_LOST_AFTER_MS = 60_000;
export const OUTBOX_MAX_ATTEMPTS = 8;

/**
 * Relay + reconciler in one bounded pass. Publishes:
 *  - undispatched due rows;
 *  - dispatched rows never claimed within OUTBOX_LOST_AFTER_MS (queue loss);
 *  - claimed rows whose lease expired (worker crash).
 * Job IDs include the dispatch timestamp, so a republish is never swallowed by queue dedup
 * of an older job; the handler's claim step provides the real deduplication.
 */
export async function relayOutbox(db: Db, clock: Clock, publish: Publisher, limit = 200): Promise<{ published: number; reconciled: number }> {
  const now = clock.now();
  const lostBefore = new Date(now.getTime() - OUTBOX_LOST_AFTER_MS);
  const rows = await db.outboxEvent.findMany({
    where: {
      completedAt: null,
      availableAt: { lte: now },
      attempts: { lt: OUTBOX_MAX_ATTEMPTS },
      OR: [
        { dispatchedAt: null },
        { dispatchedAt: { lt: lostBefore }, processingStartedAt: null },
        { leaseExpiresAt: { lt: now } },
      ],
    },
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  let published = 0;
  let reconciled = 0;
  for (const r of rows) {
    // Conditional update so two relays never both publish the same dispatch.
    const res = await db.outboxEvent.updateMany({
      where: { id: r.id, dispatchedAt: r.dispatchedAt, completedAt: null },
      data: { dispatchedAt: now, processingStartedAt: null, leaseExpiresAt: null },
    });
    if (res.count === 0) continue;
    await publish({ name: r.type as OutboxType, outboxId: r.id, jobId: `ob_${r.id}_${now.getTime()}` });
    if (r.dispatchedAt) reconciled++;
    else published++;
  }
  return { published, reconciled };
}

export type Claimed = { id: string; type: OutboxType; payload: unknown; attempts: number };

/** Claim a row for processing. Returns null if completed or currently leased by another worker. */
export async function claimOutbox(db: Db, clock: Clock, id: string): Promise<Claimed | null> {
  const now = clock.now();
  const res = await db.outboxEvent.updateMany({
    where: { id, completedAt: null, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }] },
    data: { processingStartedAt: now, leaseExpiresAt: new Date(now.getTime() + OUTBOX_LEASE_MS), attempts: { increment: 1 } },
  });
  if (res.count === 0) return null;
  const r = await db.outboxEvent.findUniqueOrThrow({ where: { id } });
  return { id: r.id, type: r.type as OutboxType, payload: r.payload, attempts: r.attempts };
}

export async function completeOutbox(db: Db, clock: Clock, id: string): Promise<void> {
  await db.outboxEvent.update({ where: { id }, data: { completedAt: clock.now(), leaseExpiresAt: null, lastError: null } });
}

/** Release a claim after a failure so the reconciler retries after `retryAt`. */
export async function failOutbox(db: Db, id: string, error: string, retryAt: Date): Promise<void> {
  await db.outboxEvent.update({
    where: { id },
    data: { lastError: error.slice(0, 500), availableAt: retryAt, dispatchedAt: null, processingStartedAt: null, leaseExpiresAt: null },
  });
}
