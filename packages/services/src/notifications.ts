/**
 * Notification delivery (Section 21).
 *
 * Delivery guarantee (documented in docs/architecture.md): in-app events are durable and exactly
 * one per logical key. Email is at-most-once per logical delivery *from BuyTrail's side*:
 *  - before calling the provider we commit sendStartedAt;
 *  - if the worker crashes after that and the lease expires, the outcome is unknown; we try the
 *    local mailbox lookup (Mailpit) and otherwise mark unknown_outcome and do NOT resend (G18);
 *  - definite non-sends (connection refused, 4xx) are retried with backoff.
 * We never claim exactly-once email.
 *
 * Immediately before sending, the delivery is revalidated: user active, preferences, watch
 * active, rule version current, offer still eligible and still meets target (Section 19.4).
 */
import { withTx, type Db } from "@buytrail/db";
import { backoffMs, emailNotBefore, formatMoney, money, type Clock } from "@buytrail/domain";
import type { AppConfig } from "@buytrail/config";
import { compareVariant } from "./catalog";
import { SendError, type Mailer } from "./mailer";
import { enqueueOutbox } from "./outbox";

export const DELIVERY_LEASE_MS = 2 * 60_000;
export const DELIVERY_MAX_ATTEMPTS = 6;

export type DispatchOutcome =
  | "accepted"
  | "suppressed"
  | "cancelled"
  | "deferred"
  | "retry_scheduled"
  | "permanent_failure"
  | "unknown_outcome"
  | "not_claimable";

type PriceAlertPayload = {
  watchId: string;
  ruleVersion: number;
  title: string;
  condition: string;
  target: { amountMinor: string; currency: string };
  observedTotal: { amountMinor: string; currency: string };
  merchant: string;
  checkedAt: string;
  headline: string;
  offerId: string;
  productId: string;
  variantId: string;
  isDemo: boolean;
};

type ReminderPayload = {
  purchaseItemId: string;
  deadlineId: string;
  generation: number;
  description: string;
  date: string;
  cutoffTime: string | null;
  timezone: string;
  source: string;
  offsetDays: number;
};

async function suppress(db: Db, id: string, reason: string, state: "suppressed" | "cancelled" = "suppressed") {
  await db.notificationDelivery.update({ where: { id }, data: { state, suppressedReason: reason, leaseExpiresAt: null } });
}

/** Revalidate a price alert right before sending. Returns a suppression reason or null. */
async function revalidatePriceAlert(db: Db, now: Date, p: PriceAlertPayload): Promise<{ reason: string } | { ok: true; total: bigint; merchant: string; outboundUrl: string; checkedAt: Date }> {
  const w = await db.watch.findUnique({ where: { id: p.watchId } });
  if (!w || w.lifecycle !== "active") return { reason: w?.lifecycle === "paused" ? "watch_paused" : "watch_deleted" };
  if (w.ruleVersion !== p.ruleVersion) return { reason: "rule_version_superseded" };
  const { result, quotes } = await compareVariant(db, { variantId: w.variantId, contextId: w.contextId, condition: w.condition as "new", now });
  const best = result.best;
  if (!best) return { reason: "no_longer_eligible" };
  if (best.knownTotal!.amountMinor > w.targetMinor) return { reason: "no_longer_meets_target" };
  const q = quotes.find((x) => x.id === best.offer.offerId)!;
  return { ok: true, total: best.knownTotal!.amountMinor, merchant: q.listing.merchant?.name ?? q.listing.sellerKey, outboundUrl: q.listing.outboundUrl, checkedAt: q.lastSuccessfulCheckAt };
}

export function renderPriceAlert(config: AppConfig, p: PriceAlertPayload, live: { total: bigint; merchant: string; outboundUrl: string; checkedAt: Date }) {
  const demo = p.isDemo ? "[Sample data — demonstration mode] " : "";
  const total = formatMoney(money(live.total));
  const target = formatMoney(money(BigInt(p.target.amountMinor)));
  const watchUrl = `${config.APP_BASE_URL}/watchlist#${p.watchId}`;
  const prefsUrl = `${config.APP_BASE_URL}/settings`;
  const text = [
    p.isDemo ? "SAMPLE DATA — this alert comes from BuyTrail's demonstration catalog, not a real retailer.\n" : "",
    `${p.headline}.`,
    "",
    `Item: ${p.title}`,
    `Condition: ${p.condition}`,
    `Known total before tax: ${total} (your target: ${target})`,
    "This total is item price + known shipping + known mandatory fees. Tax is not included; retailer checkout is authoritative.",
    `Seller: ${live.merchant}`,
    `Checked: ${live.checkedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`,
    `Offer: ${live.outboundUrl}`,
    "",
    `Your watch: ${watchUrl}`,
    `Notification preferences / opt out: ${prefsUrl}`,
  ].join("\n");
  return { subject: `${demo}${p.headline}: ${total}`, text };
}

export function renderReminder(config: AppConfig, p: ReminderPayload, isDemo: boolean) {
  const when = p.cutoffTime ? `${p.date} at ${p.cutoffTime} (${p.timezone})` : `${p.date} (${p.timezone})`;
  const sourceText =
    p.source === "user_entered" ? "a date you entered" : p.source === "user_confirmed_extraction" ? "a date you confirmed from your receipt" : "a verified retailer policy";
  const text = [
    isDemo ? "SAMPLE DATA — demonstration mode.\n" : "",
    `Reminder: the return date you set for "${p.description}" is ${when}.`,
    `This date comes from ${sourceText}. BuyTrail cannot confirm that the retailer will accept a return; check the retailer's policy.`,
    "",
    `Manage this purchase: ${config.APP_BASE_URL}/purchases`,
    `Notification preferences: ${config.APP_BASE_URL}/settings`,
  ].join("\n");
  return { subject: `${isDemo ? "[Sample] " : ""}Return date reminder: ${p.description} — ${p.date}`, text };
}

/** Process one delivery. Safe to run concurrently and repeatedly. */
export async function dispatchDelivery(db: Db, config: AppConfig, clock: Clock, mailer: Mailer, deliveryId: string): Promise<DispatchOutcome> {
  const now = clock.now();
  const d0 = await db.notificationDelivery.findUnique({ where: { id: deliveryId }, include: { event: true } });
  if (!d0) return "not_claimable";

  // Ambiguous previous attempt: lease expired after sendStartedAt was committed (G18).
  if (d0.state === "claimed" && d0.sendStartedAt && d0.leaseExpiresAt && d0.leaseExpiresAt < now) {
    const found = await mailer.lookup(d0.idempotencyKey);
    if (found?.accepted) {
      await db.notificationDelivery.update({ where: { id: d0.id }, data: { state: "accepted", acceptedAt: now, leaseExpiresAt: null } });
      return "accepted";
    }
    if (found && !found.accepted) {
      // Reconciled: provider has no record → definitely not accepted; safe to retry.
      await db.notificationDelivery.update({ where: { id: d0.id }, data: { state: "retryable_failure", sendStartedAt: null, leaseExpiresAt: null, lastError: "reconciled_not_found" } });
    } else {
      await db.notificationDelivery.update({ where: { id: d0.id }, data: { state: "unknown_outcome", leaseExpiresAt: null, lastError: "worker_lost_after_send_started" } });
      return "unknown_outcome";
    }
  }

  // Claim: pending/retryable and due, or claimed with expired lease and no send started.
  const claim = await db.notificationDelivery.updateMany({
    where: {
      id: deliveryId,
      notBefore: { lte: now },
      OR: [
        { state: { in: ["pending", "retryable_failure"] } },
        { state: "claimed", sendStartedAt: null, leaseExpiresAt: { lt: now } },
      ],
    },
    data: { state: "claimed", claimedAt: now, leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), attempts: { increment: 1 } },
  });
  if (claim.count === 0) {
    const cur = await db.notificationDelivery.findUnique({ where: { id: deliveryId } });
    if (cur && ["pending", "retryable_failure"].includes(cur.state) && cur.notBefore > now) return "deferred";
    return "not_claimable";
  }
  const d = (await db.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { event: { include: { user: true } } } }))!;
  const ev = d.event;
  const user = ev.user;

  // Account / preference revalidation.
  if (user.deletionState !== "active") {
    await suppress(db, d.id, "account_deleted", "cancelled");
    return "cancelled";
  }
  const isPrice = ev.type === "price_target_met";
  if ((isPrice && !user.emailAlerts) || (!isPrice && ev.type === "return_reminder" && !user.emailReminders)) {
    await suppress(db, d.id, "email_preference_off");
    return "suppressed";
  }
  if (config.EMAIL_MODE === "disabled") {
    await suppress(db, d.id, "email_disabled_in_environment");
    return "suppressed";
  }
  if (config.APP_MODE !== "local" && config.emailAllowlist.length && !config.emailAllowlist.includes(user.email.toLowerCase())) {
    await suppress(db, d.id, "recipient_not_in_test_allowlist");
    return "suppressed";
  }

  // Per-user daily and global hourly limits (Section 31).
  const [userToday, globalHour] = await Promise.all([
    db.notificationDelivery.count({ where: { state: "accepted", acceptedAt: { gt: new Date(now.getTime() - 86400_000) }, event: { userId: user.id } } }),
    db.notificationDelivery.count({ where: { state: "accepted", acceptedAt: { gt: new Date(now.getTime() - 3600_000) } } }),
  ]);
  if (userToday >= config.EMAIL_USER_LIMIT_PER_DAY || globalHour >= config.EMAIL_GLOBAL_LIMIT_PER_HOUR) {
    await db.notificationDelivery.update({ where: { id: d.id }, data: { state: "pending", notBefore: new Date(now.getTime() + 3600_000), leaseExpiresAt: null, lastError: "rate_limited_locally" } });
    await enqueueOutbox(db, "notification.dispatch", `delivery:${d.id}`, { deliveryId: d.id }, new Date(now.getTime() + 3600_000));
    return "deferred";
  }

  let content: { subject: string; text: string };
  if (isPrice) {
    const p = ev.payload as unknown as PriceAlertPayload;
    // Cooldown recheck: another episode's email may have been accepted after this was created.
    const w = await db.watch.findUnique({ where: { id: p.watchId } });
    const nb = emailNotBefore(w?.lastEmailAcceptedAt ?? null, now, config.PRICE_ALERT_EMAIL_COOLDOWN_HOURS);
    if (nb > now) {
      await db.notificationDelivery.update({ where: { id: d.id }, data: { state: "pending", notBefore: nb, leaseExpiresAt: null } });
      await enqueueOutbox(db, "notification.dispatch", `delivery:${d.id}`, { deliveryId: d.id }, nb);
      return "deferred";
    }
    const v = await revalidatePriceAlert(db, now, p);
    if ("reason" in v) {
      await suppress(db, d.id, v.reason, v.reason === "watch_deleted" ? "cancelled" : "suppressed");
      return v.reason === "watch_deleted" ? "cancelled" : "suppressed";
    }
    content = renderPriceAlert(config, p, v);
  } else if (ev.type === "return_reminder") {
    const p = ev.payload as unknown as ReminderPayload;
    const dl = await db.returnDeadline.findUnique({ where: { id: p.deadlineId }, include: { purchaseItem: { include: { purchase: true } } } });
    if (!dl || dl.removedAt || dl.generation !== p.generation || dl.purchaseItem.status !== "kept" || dl.purchaseItem.purchase.status !== "active") {
      await suppress(db, d.id, "reminder_obsolete", "cancelled");
      return "cancelled";
    }
    content = renderReminder(config, p, ev.isDemo);
  } else {
    await suppress(db, d.id, "unsupported_event_type");
    return "suppressed";
  }

  // Commit intent before the external side effect.
  const started = await db.notificationDelivery.updateMany({ where: { id: d.id, state: "claimed", sendStartedAt: null }, data: { sendStartedAt: clock.now() } });
  if (started.count === 0) return "not_claimable";
  try {
    const r = await mailer.send({ to: user.email, subject: content.subject, text: content.text, idempotencyKey: d.idempotencyKey });
    const acceptedAt = clock.now();
    await withTx(db, async (tx) => {
      await tx.notificationDelivery.update({ where: { id: d.id }, data: { state: "accepted", acceptedAt, providerMessageId: r.providerMessageId, leaseExpiresAt: null, lastError: null } });
      if (isPrice) {
        const p = ev.payload as unknown as PriceAlertPayload;
        await tx.watch.update({ where: { id: p.watchId }, data: { lastEmailAcceptedAt: acceptedAt, lastEmailAttemptAt: acceptedAt } });
      }
    });
    return "accepted";
  } catch (e) {
    const se = e instanceof SendError ? e : new SendError("ambiguous", String((e as Error)?.message ?? e));
    if (se.kind === "ambiguous") {
      // Pilot policy: never blindly resend an ambiguous email; the event stays visible in-app.
      const found = await mailer.lookup(d.idempotencyKey);
      const state = found?.accepted ? "accepted" : "unknown_outcome";
      await db.notificationDelivery.update({ where: { id: d.id }, data: { state, acceptedAt: found?.accepted ? clock.now() : null, leaseExpiresAt: null, lastError: se.message.slice(0, 300) } });
      return state;
    }
    if (se.kind === "permanent" || d.attempts >= DELIVERY_MAX_ATTEMPTS) {
      await db.notificationDelivery.update({ where: { id: d.id }, data: { state: "permanent_failure", leaseExpiresAt: null, lastError: se.message.slice(0, 300) } });
      return "permanent_failure";
    }
    const retryAt = new Date(clock.now().getTime() + backoffMs(d.attempts, { baseMs: 30_000, maxMs: 3600_000 }));
    await db.notificationDelivery.update({ where: { id: d.id }, data: { state: "retryable_failure", sendStartedAt: null, notBefore: retryAt, leaseExpiresAt: null, lastError: se.message.slice(0, 300) } });
    await enqueueOutbox(db, "notification.dispatch", `delivery:${d.id}`, { deliveryId: d.id }, retryAt);
    return "retry_scheduled";
  }
}

/** Reconciler: find deliveries that are due or stuck and (re)enqueue them. */
export async function reconcileDeliveries(db: Db, clock: Clock, limit = 200): Promise<number> {
  const now = clock.now();
  const due = await db.notificationDelivery.findMany({
    where: {
      OR: [
        { state: { in: ["pending", "retryable_failure"] }, notBefore: { lte: now } },
        { state: "claimed", leaseExpiresAt: { lt: now } },
      ],
    },
    select: { id: true },
    take: limit,
  });
  for (const d of due) {
    const pending = await db.outboxEvent.findFirst({ where: { type: "notification.dispatch", entityKey: `delivery:${d.id}`, completedAt: null } });
    if (!pending) await enqueueOutbox(db, "notification.dispatch", `delivery:${d.id}`, { deliveryId: d.id }, now);
  }
  return due.length;
}

// ── In-app inbox ─────────────────────────────────────────────────────────────────────────

export async function listNotifications(db: Db, userId: string, limit = 50) {
  const events = await db.notificationEvent.findMany({
    where: { userId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: Math.min(limit, 100),
    include: { deliveries: { select: { channel: true, state: true, suppressedReason: true, acceptedAt: true, notBefore: true } } },
  });
  return events.map((e) => ({
    id: e.id,
    type: e.type,
    createdAt: e.createdAt.toISOString(),
    readAt: e.readAt?.toISOString() ?? null,
    isDemo: e.isDemo,
    payload: e.payload as Record<string, unknown>,
    deliveries: e.deliveries.map((d) => ({
      channel: d.channel,
      state: d.state,
      suppressedReason: d.suppressedReason,
      acceptedAt: d.acceptedAt?.toISOString() ?? null,
      notBefore: d.notBefore.toISOString(),
    })),
  }));
}

export async function markNotificationsRead(db: Db, userId: string, ids: string[], now: Date) {
  const r = await db.notificationEvent.updateMany({ where: { userId, id: { in: ids.slice(0, 100) }, readAt: null }, data: { readAt: now } });
  return r.count;
}
