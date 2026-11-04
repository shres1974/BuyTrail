/**
 * Target-price watches (Section 19). Domain transitions live in @buytrail/domain/watch; this
 * module persists them under row locks so concurrent workers produce one episode and one
 * logical event (G13), and writes event + delivery + outbox in the same transaction.
 */
import { withTx, type Db, type Tx } from "@buytrail/db";
import {
  emailNotBefore,
  evaluateWatch,
  formatMoney,
  initialWatchState,
  money,
  parseMinor,
  type WatchState,
} from "@buytrail/domain";
import type { AppConfig } from "@buytrail/config";
import { z } from "zod";
import { compareVariant, PUBLIC_CONTEXT_ID } from "./catalog";
import { AppError, notFound } from "./errors";
import { beginIdempotent, finishIdempotent } from "./idempotency";
import { currentVariantGeneration } from "./ingestion";
import { enqueueOutbox } from "./outbox";
import type { Actor } from "./auth-types";

type WatchRow = NonNullable<Awaited<ReturnType<Tx["watch"]["findUnique"]>>>;

const toState = (w: WatchRow): WatchState => ({
  lifecycle: w.lifecycle as WatchState["lifecycle"],
  qualification: w.qualification as WatchState["qualification"],
  lastKnownQualification: w.lastKnownQualification as WatchState["lastKnownQualification"],
  episode: w.episode,
  rearmStreak: w.rearmStreak,
  lastEvaluatedGeneration: w.lastEvaluatedGeneration,
  ruleVersion: w.ruleVersion,
});

async function lockWatch(tx: Tx, id: string): Promise<WatchRow | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM watch WHERE "id" = ${id} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.watch.findUnique({ where: { id } });
}

/** Best eligible known total for the watch's exact inputs, recomputed now. */
async function bestFor(tx: Tx, w: Pick<WatchRow, "variantId" | "contextId" | "condition">, now: Date) {
  const { result } = await compareVariant(tx, { variantId: w.variantId, contextId: w.contextId, condition: w.condition as "new", now });
  return result.best ? { total: result.best.knownTotal!, offerId: result.best.offer.offerId } : null;
}

/** Create the logical event, and an email delivery (respecting cooldown/preferences). */
async function createPriceEvent(
  tx: Tx,
  config: AppConfig,
  w: WatchRow,
  ev: { logicalKey: string; reason: "crossing" | "already_qualifying"; episode: number },
  best: { total: ReturnType<typeof money>; offerId: string },
  now: Date,
): Promise<string | null> {
  const offer = await tx.offerQuote.findUnique({ where: { id: best.offerId }, include: { listing: { include: { merchant: true } } } });
  const variant = await tx.productVariant.findUniqueOrThrow({ where: { id: w.variantId }, include: { product: true } });
  const payload = {
    watchId: w.id,
    ruleVersion: w.ruleVersion,
    episode: ev.episode,
    reason: ev.reason,
    variantId: w.variantId,
    productId: variant.productId,
    title: `${variant.product.title} — ${variant.label}`,
    condition: w.condition,
    target: { amountMinor: w.targetMinor.toString(), currency: w.currency },
    observedTotal: { amountMinor: best.total.amountMinor.toString(), currency: best.total.currency },
    offerId: best.offerId,
    merchant: offer?.listing.merchant?.name ?? offer?.listing.sellerKey ?? "Unknown seller",
    checkedAt: offer?.lastSuccessfulCheckAt.toISOString() ?? now.toISOString(),
    headline: ev.reason === "crossing" ? "Price dropped to your target" : "An offer meets your target",
    summary: `${formatMoney(best.total)} known total before tax (target ${formatMoney(money(w.targetMinor))}).`,
    isDemo: variant.isDemo,
  };
  let eventId: string;
  try {
    const e = await tx.notificationEvent.create({
      data: { userId: w.userId, type: "price_target_met", logicalKey: ev.logicalKey, payload, watchId: w.id, ruleVersion: w.ruleVersion, isDemo: variant.isDemo, createdAt: now },
    });
    eventId = e.id;
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") return null; // logical event already exists (G12)
    throw err;
  }
  const user = await tx.user.findUniqueOrThrow({ where: { id: w.userId } });
  const wantsEmail =
    w.channels.includes("email") && user.emailAlerts && !user.categoryEmailOptOut.includes(variant.product.category) && user.deletionState === "active";
  if (wantsEmail) {
    const notBefore = emailNotBefore(w.lastEmailAcceptedAt, now, config.PRICE_ALERT_EMAIL_COOLDOWN_HOURS);
    const d = await tx.notificationDelivery.create({
      data: { eventId, channel: "email", state: "pending", notBefore, idempotencyKey: `dlv:${ev.logicalKey}:email` },
    });
    await enqueueOutbox(tx, "notification.dispatch", `delivery:${d.id}`, { deliveryId: d.id }, notBefore);
  }
  return eventId;
}

export type EvalSummary = { evaluated: number; events: number; decisions: Record<string, number> };

/**
 * Evaluate every active watch on (variant, context) against the current eligible state.
 * Each watch is evaluated in its own transaction under a row lock.
 */
export async function evaluateWatchesFor(db: Db, config: AppConfig, now: Date, variantId: string, contextId: string): Promise<EvalSummary> {
  const ids = await db.watch.findMany({ where: { variantId, contextId, lifecycle: "active" }, select: { id: true }, orderBy: { id: "asc" } });
  const summary: EvalSummary = { evaluated: 0, events: 0, decisions: {} };
  for (const { id } of ids) {
    const r = await evaluateOneWatch(db, config, now, id);
    if (!r) continue;
    summary.evaluated++;
    summary.decisions[r.decision] = (summary.decisions[r.decision] ?? 0) + 1;
    if (r.eventId) summary.events++;
  }
  return summary;
}

export async function evaluateOneWatch(db: Db, config: AppConfig, now: Date, watchId: string) {
  return withTx(db, async (tx) => {
    const w = await lockWatch(tx, watchId);
    if (!w || w.lifecycle !== "active") return null;
    // Read the generation inside the lock so it is ≥ any input this evaluation reflects.
    const generation = await currentVariantGeneration(tx, w.variantId, w.contextId);
    const best = await bestFor(tx, w, now);
    const out = evaluateWatch(w.id, toState(w), { target: money(w.targetMinor) }, { bestEligibleTotal: best?.total ?? null, bestOfferId: best?.offerId ?? null, generation });
    if (out.decision === "skipped_stale_generation" || out.decision === "skipped_inactive") return { decision: out.decision, eventId: null };
    await tx.watch.update({
      where: { id: w.id },
      data: {
        qualification: out.next.qualification,
        lastKnownQualification: out.next.lastKnownQualification,
        episode: out.next.episode,
        rearmStreak: out.next.rearmStreak,
        lastEvaluatedGeneration: out.next.lastEvaluatedGeneration,
        lastBestTotalMinor: best?.total.amountMinor ?? null,
        lastBestOfferId: best?.offerId ?? null,
        lastEvaluatedAt: now,
      },
    });
    await tx.watchEvaluation.create({
      data: { watchId: w.id, ruleVersion: w.ruleVersion, generation, decision: out.decision, bestTotalMinor: best?.total.amountMinor ?? null, bestOfferId: best?.offerId ?? null, createdAt: now },
    });
    let eventId: string | null = null;
    if (out.event && best) eventId = await createPriceEvent(tx, config, w, out.event, best, now);
    return { decision: out.decision, eventId };
  });
}

// ── CRUD ─────────────────────────────────────────────────────────────────────────────────

export const watchCreateSchema = z.object({
  variantId: z.string().min(1).max(100),
  condition: z.enum(["new", "refurbished", "used"]).default("new"),
  contextId: z.string().min(1).max(100).default(PUBLIC_CONTEXT_ID),
  target: z.object({ amountMinor: z.string(), currency: z.literal("CAD") }),
  channels: z.array(z.enum(["in_app", "email"])).min(1).max(2).default(["in_app"]),
  notifyIfAlreadyQualifying: z.boolean().default(false),
});
export type WatchCreateInput = z.infer<typeof watchCreateSchema>;

export const watchPatchSchema = z.object({
  version: z.number().int().min(1),
  target: z.object({ amountMinor: z.string(), currency: z.literal("CAD") }).optional(),
  condition: z.enum(["new", "refurbished", "used"]).optional(),
  contextId: z.string().min(1).max(100).optional(),
  channels: z.array(z.enum(["in_app", "email"])).min(1).max(2).optional(),
  lifecycle: z.enum(["active", "paused"]).optional(),
  notifyIfAlreadyQualifying: z.boolean().optional(),
});
export type WatchPatchInput = z.infer<typeof watchPatchSchema>;

function parseTarget(t: { amountMinor: string }): bigint {
  let v: bigint;
  try {
    v = parseMinor(t.amountMinor);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Target must be a valid CAD amount", { fields: { target: "Enter a valid amount, e.g. 195.00" } });
  }
  if (v <= 0n) throw new AppError("VALIDATION_FAILED", "Target must be greater than zero", { fields: { target: "Must be greater than zero" } });
  return v;
}

async function assertContextAccess(tx: Tx, actor: Actor, contextId: string) {
  const ctx = await tx.quoteContext.findUnique({ where: { id: contextId } });
  if (!ctx || (ctx.ownerUserId !== null && ctx.ownerUserId !== actor.id)) throw notFound("Quote context");
  return ctx;
}

export async function watchDTO(tx: Tx | Db, w: WatchRow, now: Date) {
  const variant = await tx.productVariant.findUnique({ where: { id: w.variantId }, include: { product: true } });
  const { result } = await compareVariant(tx, { variantId: w.variantId, contextId: w.contextId, condition: w.condition as "new", now });
  const best = result.best;
  const lastCheck = await tx.offerQuote.aggregate({ _max: { lastSuccessfulCheckAt: true, lastCheckFailedAt: true }, where: { contextId: w.contextId, listing: { variantId: w.variantId } } });
  const status =
    w.lifecycle === "paused"
      ? "Paused"
      : best
        ? best.knownTotal!.amountMinor <= w.targetMinor
          ? "Meets target"
          : "Watching"
        : result.incompleteTotal.length + result.stale.length > 0
          ? "No eligible offer (totals unconfirmed or stale)"
          : lastCheck._max.lastCheckFailedAt && (!lastCheck._max.lastSuccessfulCheckAt || lastCheck._max.lastCheckFailedAt > lastCheck._max.lastSuccessfulCheckAt)
            ? "Unable to check"
            : "No eligible offer";
  return {
    id: w.id,
    version: w.version,
    variantId: w.variantId,
    productId: variant?.productId ?? null,
    title: variant ? `${variant.product.title} — ${variant.label}` : w.variantId,
    modelCode: variant?.modelCode ?? null,
    condition: w.condition,
    contextId: w.contextId,
    target: { amountMinor: w.targetMinor.toString(), currency: w.currency, display: formatMoney(money(w.targetMinor)) },
    channels: w.channels,
    lifecycle: w.lifecycle,
    qualification: w.qualification,
    episode: w.episode,
    ruleVersion: w.ruleVersion,
    currentBest: best ? { amountMinor: best.knownTotal!.amountMinor.toString(), currency: "CAD", display: formatMoney(best.knownTotal!), offerId: best.offer.offerId } : null,
    status,
    lastEvaluatedAt: w.lastEvaluatedAt?.toISOString() ?? null,
    lastCheckAt: lastCheck._max.lastSuccessfulCheckAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    isDemo: variant?.isDemo ?? false,
  };
}

export type WatchDTO = Awaited<ReturnType<typeof watchDTO>>;

export async function createWatch(db: Db, config: AppConfig, now: Date, actor: Actor, raw: unknown, idempotencyKey: string | null) {
  const input = watchCreateSchema.parse(raw);
  const target = parseTarget(input.target);
  const out = await withTx(db, async (tx) => {
    let idem: Awaited<ReturnType<typeof beginIdempotent>> | null = null;
    if (idempotencyKey) {
      idem = await beginIdempotent(tx, actor.id, "watch.create", idempotencyKey, input, now);
      if (idem.kind === "replay" && idem.responseRef) {
        const w = await tx.watch.findFirst({ where: { id: idem.responseRef, userId: actor.id } });
        if (w) return { watch: w, replay: true, alreadyQualifying: false };
      }
    }
    const variant = await tx.productVariant.findUnique({ where: { id: input.variantId } });
    if (!variant) throw new AppError("VALIDATION_FAILED", "Unknown variant", { fields: { variantId: "Choose an exact variant" } });
    await assertContextAccess(tx, actor, input.contextId);
    const active = await tx.watch.count({ where: { userId: actor.id, lifecycle: { in: ["active", "paused"] } } });
    if (active >= config.MAX_ACTIVE_WATCHES_PER_USER) throw new AppError("LIMIT_EXCEEDED", `You can keep up to ${config.MAX_ACTIVE_WATCHES_PER_USER} watches.`);
    const generation = await currentVariantGeneration(tx, input.variantId, input.contextId);
    const best = await bestFor(tx, { variantId: input.variantId, contextId: input.contextId, condition: input.condition }, now);
    const created = await tx.watch.create({
      data: {
        userId: actor.id,
        variantId: input.variantId,
        condition: input.condition,
        contextId: input.contextId,
        targetMinor: target,
        channels: input.channels,
        notifyIfAlreadyQualifying: input.notifyIfAlreadyQualifying,
        createdAt: now,
      },
    });
    const init = initialWatchState(created.id, 1, { target: money(target) }, { bestEligibleTotal: best?.total ?? null, bestOfferId: best?.offerId ?? null, generation }, input.notifyIfAlreadyQualifying);
    const w = await tx.watch.update({
      where: { id: created.id },
      data: {
        qualification: init.state.qualification,
        lastKnownQualification: init.state.lastKnownQualification,
        episode: init.state.episode,
        lastEvaluatedGeneration: init.state.lastEvaluatedGeneration,
        lastBestTotalMinor: best?.total.amountMinor ?? null,
        lastBestOfferId: best?.offerId ?? null,
        lastEvaluatedAt: now,
      },
    });
    if (init.event && best) await createPriceEvent(tx, config, w, init.event, best, now);
    if (idem?.kind === "new") await finishIdempotent(tx, idem.recordId, w.id, 201);
    return { watch: w, replay: false, alreadyQualifying: init.state.qualification === "satisfied" };
  });
  return { ...out, dto: await watchDTO(db, out.watch, now) };
}

export async function listWatches(db: Db, now: Date, actor: Actor) {
  const ws = await db.watch.findMany({ where: { userId: actor.id, lifecycle: { not: "deleted" } }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 200 });
  return Promise.all(ws.map((w) => watchDTO(db, w, now)));
}

export async function getOwnedWatch(db: Db | Tx, actor: Actor, id: string) {
  const w = await db.watch.findFirst({ where: { id, userId: actor.id, lifecycle: { not: "deleted" } } });
  if (!w) throw notFound("Watch");
  return w;
}

/** Cancel not-yet-accepted email deliveries for a watch (optionally only older rule versions). */
async function cancelPendingDeliveries(tx: Tx, watchId: string, reason: string, beforeRuleVersion?: number) {
  const events = await tx.notificationEvent.findMany({
    where: { watchId, ...(beforeRuleVersion ? { ruleVersion: { lt: beforeRuleVersion } } : {}) },
    select: { id: true },
  });
  if (!events.length) return 0;
  const r = await tx.notificationDelivery.updateMany({
    where: { eventId: { in: events.map((e) => e.id) }, state: { in: ["pending", "retryable_failure"] } },
    data: { state: "cancelled", suppressedReason: reason },
  });
  return r.count;
}

export async function updateWatch(db: Db, config: AppConfig, now: Date, actor: Actor, id: string, raw: unknown) {
  const input = watchPatchSchema.parse(raw);
  const w = await withTx(db, async (tx) => {
    const cur = await lockWatch(tx, id);
    if (!cur || cur.userId !== actor.id || cur.lifecycle === "deleted") throw notFound("Watch");
    if (cur.version !== input.version) {
      throw new AppError("VERSION_CONFLICT", "This watch changed in another tab. Refresh before saving.", { current: await watchDTO(tx, cur, now) });
    }
    const target = input.target ? parseTarget(input.target) : cur.targetMinor;
    const condition = input.condition ?? cur.condition;
    const contextId = input.contextId ?? cur.contextId;
    if (input.contextId) await assertContextAccess(tx, actor, contextId);
    const ruleChanged = target !== cur.targetMinor || condition !== cur.condition || contextId !== cur.contextId;
    const lifecycle = input.lifecycle ?? cur.lifecycle;
    let data: Record<string, unknown> = {
      targetMinor: target,
      condition,
      contextId,
      channels: input.channels ?? cur.channels,
      lifecycle,
      notifyIfAlreadyQualifying: input.notifyIfAlreadyQualifying ?? cur.notifyIfAlreadyQualifying,
      version: { increment: 1 },
    };
    if (lifecycle === "paused" && cur.lifecycle !== "paused") await cancelPendingDeliveries(tx, cur.id, "watch_paused");
    const resuming = lifecycle === "active" && cur.lifecycle === "paused";
    if (ruleChanged || resuming) {
      // New rule version (on edit) or fresh baseline (on resume): re-initialize, explicit initial notification only.
      const ruleVersion = ruleChanged ? cur.ruleVersion + 1 : cur.ruleVersion;
      if (ruleChanged) await cancelPendingDeliveries(tx, cur.id, "rule_version_superseded", ruleVersion);
      const generation = await currentVariantGeneration(tx, cur.variantId, contextId);
      const best = await bestFor(tx, { variantId: cur.variantId, contextId, condition }, now);
      const notify = input.notifyIfAlreadyQualifying ?? false;
      const init = initialWatchState(cur.id, ruleVersion, { target: money(target) }, { bestEligibleTotal: best?.total ?? null, bestOfferId: best?.offerId ?? null, generation }, notify, cur.episode);
      // Resuming keeps the same rule version: if already satisfied in this version, do not start a new episode.
      const keepEpisode = !ruleChanged && cur.lastKnownQualification === "satisfied" && init.state.qualification === "satisfied";
      data = {
        ...data,
        ruleVersion,
        qualification: init.state.qualification,
        lastKnownQualification: init.state.lastKnownQualification,
        episode: keepEpisode ? cur.episode : init.state.episode,
        rearmStreak: 0,
        lastEvaluatedGeneration: generation,
        lastBestTotalMinor: best?.total.amountMinor ?? null,
        lastBestOfferId: best?.offerId ?? null,
        lastEvaluatedAt: now,
      };
      const updated = await tx.watch.update({ where: { id: cur.id }, data });
      if (init.event && best && !keepEpisode) await createPriceEvent(tx, config, updated, init.event, best, now);
      return updated;
    }
    return tx.watch.update({ where: { id: cur.id }, data });
  });
  return watchDTO(db, w, now);
}

export async function deleteWatch(db: Db, actor: Actor, id: string) {
  await withTx(db, async (tx) => {
    const cur = await lockWatch(tx, id);
    if (!cur || cur.userId !== actor.id || cur.lifecycle === "deleted") throw notFound("Watch");
    await cancelPendingDeliveries(tx, cur.id, "watch_deleted");
    await tx.watch.update({ where: { id }, data: { lifecycle: "deleted", version: { increment: 1 } } });
  });
}

/** Pause active watches for a variant after a purchase, when the user opts in (Section 6.4). */
export async function pauseWatchesForVariant(tx: Tx, userId: string, variantId: string) {
  const ws = await tx.watch.findMany({ where: { userId, variantId, lifecycle: "active" }, select: { id: true } });
  for (const w of ws) {
    await cancelPendingDeliveries(tx, w.id, "watch_paused_after_purchase");
    await tx.watch.update({ where: { id: w.id }, data: { lifecycle: "paused", version: { increment: 1 } } });
  }
  return ws.length;
}
