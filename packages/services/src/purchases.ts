/**
 * Purchase notebook and confirmed return deadlines (Section 22). All reads and writes are
 * owner-scoped in the query itself. Purchase descriptions and paid totals are immutable
 * snapshots independent of the catalog.
 */
import { withTx, type Db, type Tx } from "@buytrail/db";
import { formatMoney, isValidTimezone, money, parseLocalDate, parseMajor, planReminders, DateRuleError, MoneyError } from "@buytrail/domain";
import { z } from "zod";
import type { AppConfig } from "@buytrail/config";
import type { Actor } from "./auth-types";
import { AppError, notFound } from "./errors";
import { beginIdempotent, finishIdempotent } from "./idempotency";
import { pauseWatchesForVariant } from "./watches";

const amountStr = z.string().trim().max(20);

export const purchaseCreateSchema = z.object({
  merchantName: z.string().trim().min(1, "Merchant is required").max(200),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  paidTotal: amountStr.optional().nullable(),
  currency: z.enum(["CAD", "USD"]).default("CAD"),
  notes: z.string().max(2000).optional().nullable(),
  items: z
    .array(
      z.object({
        description: z.string().trim().min(1, "Describe the item").max(300),
        quantity: z.number().int().min(1).max(10000).default(1),
        variantId: z.string().max(100).optional().nullable(),
        unitPrice: amountStr.optional().nullable(),
      }),
    )
    .min(1)
    .max(50),
  pauseWatches: z.boolean().default(false),
});

export const purchasePatchSchema = z.object({
  version: z.number().int().min(1),
  merchantName: z.string().trim().min(1).max(200).optional(),
  purchasedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  paidTotal: amountStr.optional().nullable(),
  currency: z.enum(["CAD", "USD"]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  status: z.enum(["active", "cancelled"]).optional(),
});

export const deadlineSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  cutoffTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm")
    .optional()
    .nullable(),
  timezone: z.string().max(64),
  source: z.enum(["user_entered", "user_confirmed_extraction"]).default("user_entered"),
  notes: z.string().max(500).optional().nullable(),
  /** Optimistic concurrency against the current deadline generation (null when creating). */
  expectedGeneration: z.number().int().min(1).optional().nullable(),
});

function parseAmount(field: string, s: string | null | undefined): bigint | null {
  if (s === null || s === undefined || s === "") return null;
  try {
    return parseMajor(s);
  } catch (e) {
    if (e instanceof MoneyError) throw new AppError("VALIDATION_FAILED", "Invalid amount", { fields: { [field]: "Enter an amount like 205.00" } });
    throw e;
  }
}

function dateOnly(s: string): Date {
  try {
    parseLocalDate(s);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Invalid date", { fields: { purchasedOn: "Enter a real calendar date" } });
  }
  // Stored in a DATE column; UTC midnight of the same calendar date avoids any shift.
  return new Date(`${s}T00:00:00Z`);
}

export async function purchaseDTO(tx: Tx | Db, purchaseId: string, userId: string) {
  const p = await tx.purchase.findFirst({
    where: { id: purchaseId, userId },
    include: {
      items: { orderBy: { createdAt: "asc" }, include: { deadline: { include: { schedules: { orderBy: [{ generation: "desc" }, { offsetDays: "desc" }] } } } } },
      receipts: { where: { state: { notIn: ["deleted"] } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!p) throw notFound("Purchase");
  const cur = (p.currency ?? "CAD") as "CAD" | "USD";
  return {
    id: p.id,
    version: p.version,
    merchantName: p.merchantName,
    purchasedOn: p.purchasedOn.toISOString().slice(0, 10),
    paidTotal: p.paidTotalMinor === null ? null : { amountMinor: p.paidTotalMinor.toString(), currency: cur, display: formatMoney(money(p.paidTotalMinor, cur)) },
    notes: p.notes,
    status: p.status,
    isDemo: p.isDemo,
    createdAt: p.createdAt.toISOString(),
    items: p.items.map((i) => ({
      id: i.id,
      description: i.description,
      quantity: i.quantity,
      variantId: i.variantId,
      status: i.status,
      unitPrice: i.unitPriceMinor === null ? null : { amountMinor: i.unitPriceMinor.toString(), display: formatMoney(money(i.unitPriceMinor, cur)) },
      deadline:
        i.deadline && !i.deadline.removedAt
          ? {
              id: i.deadline.id,
              date: i.deadline.date,
              cutoffTime: i.deadline.cutoffTime,
              timezone: i.deadline.timezone,
              source: i.deadline.source,
              confirmedAt: i.deadline.confirmedAt.toISOString(),
              notes: i.deadline.notes,
              generation: i.deadline.generation,
              reminders: i.deadline.schedules
                .filter((s) => s.generation === i.deadline!.generation)
                .map((s) => ({ offsetDays: s.offsetDays, dueAt: s.dueAt.toISOString(), localLabel: s.localLabel, status: s.status })),
            }
          : null,
    })),
    receipts: p.receipts.map((r) => ({ id: r.id, state: r.state, declaredType: r.declaredType, size: r.actualSize ?? r.declaredSize, rejectReason: r.rejectReason, isSynthetic: r.isSynthetic, createdAt: r.createdAt.toISOString() })),
  };
}

export type PurchaseDTO = Awaited<ReturnType<typeof purchaseDTO>>;

export async function createPurchase(db: Db, now: Date, actor: Actor, raw: unknown, idempotencyKey: string | null, opts: { isDemo?: boolean } = {}) {
  const input = purchaseCreateSchema.parse(raw);
  const paid = parseAmount("paidTotal", input.paidTotal);
  const purchasedOn = dateOnly(input.purchasedOn);
  const id = await withTx(db, async (tx) => {
    let idem: Awaited<ReturnType<typeof beginIdempotent>> | null = null;
    if (idempotencyKey) {
      idem = await beginIdempotent(tx, actor.id, "purchase.create", idempotencyKey, input, now);
      if (idem.kind === "replay" && idem.responseRef) return idem.responseRef;
    }
    const items = [];
    for (const [i, it] of input.items.entries()) {
      if (it.variantId) {
        const v = await tx.productVariant.findUnique({ where: { id: it.variantId } });
        if (!v) throw new AppError("VALIDATION_FAILED", "Unknown product variant", { fields: { [`items.${i}.variantId`]: "Unknown variant" } });
      }
      items.push({ description: it.description, quantity: it.quantity, variantId: it.variantId ?? null, unitPriceMinor: parseAmount(`items.${i}.unitPrice`, it.unitPrice) });
    }
    const p = await tx.purchase.create({
      data: {
        userId: actor.id,
        merchantName: input.merchantName,
        purchasedOn,
        paidTotalMinor: paid,
        currency: paid === null ? null : input.currency,
        notes: input.notes ?? null,
        isDemo: opts.isDemo ?? false,
        createdAt: now,
        items: { create: items },
      },
    });
    if (input.pauseWatches) {
      for (const it of items) if (it.variantId) await pauseWatchesForVariant(tx, actor.id, it.variantId);
    }
    if (idem?.kind === "new") await finishIdempotent(tx, idem.recordId, p.id, 201);
    return p.id;
  });
  return purchaseDTO(db, id, actor.id);
}

export async function listPurchases(db: Db, actor: Actor, q: string | null, limit = 50) {
  const term = q?.trim().slice(0, 200) || null;
  const ps = await db.purchase.findMany({
    where: {
      userId: actor.id,
      ...(term
        ? {
            OR: [
              { merchantName: { contains: term, mode: "insensitive" } },
              { notes: { contains: term, mode: "insensitive" } },
              { items: { some: { description: { contains: term, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ purchasedOn: "desc" }, { id: "desc" }],
    take: Math.min(limit, 100),
    select: { id: true },
  });
  return Promise.all(ps.map((p) => purchaseDTO(db, p.id, actor.id)));
}

export async function getOwnedPurchase(db: Db, actor: Actor, id: string) {
  return purchaseDTO(db, id, actor.id);
}

export async function updatePurchase(db: Db, now: Date, actor: Actor, id: string, raw: unknown) {
  const input = purchasePatchSchema.parse(raw);
  await withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM purchase WHERE "id" = ${id} AND "userId" = ${actor.id} FOR UPDATE`;
    if (!rows.length) throw notFound("Purchase");
    const cur = await tx.purchase.findUniqueOrThrow({ where: { id } });
    if (cur.version !== input.version) throw new AppError("VERSION_CONFLICT", "This purchase changed elsewhere. Refresh before saving.", { current: await purchaseDTO(tx, id, actor.id) });
    const paid = input.paidTotal === undefined ? cur.paidTotalMinor : parseAmount("paidTotal", input.paidTotal);
    await tx.purchase.update({
      where: { id },
      data: {
        merchantName: input.merchantName ?? cur.merchantName,
        purchasedOn: input.purchasedOn ? dateOnly(input.purchasedOn) : cur.purchasedOn,
        paidTotalMinor: paid,
        currency: paid === null ? null : (input.currency ?? cur.currency ?? "CAD"),
        notes: input.notes === undefined ? cur.notes : input.notes,
        status: input.status ?? cur.status,
        version: { increment: 1 },
      },
    });
    if (input.status === "cancelled" && cur.status !== "cancelled") {
      // Cancel all pending reminders for this purchase (Section 22.2).
      const items = await tx.purchaseItem.findMany({ where: { purchaseId: id }, include: { deadline: true } });
      for (const it of items) if (it.deadline) await cancelSchedules(tx, it.deadline.id, null, "purchase_cancelled");
    }
  });
  return purchaseDTO(db, id, actor.id);
}

async function cancelSchedules(tx: Tx, deadlineId: string, keepGeneration: number | null, _reason: string) {
  await tx.reminderSchedule.updateMany({
    where: { deadlineId, status: { in: ["scheduled", "claimed"] }, ...(keepGeneration !== null ? { generation: { not: keepGeneration } } : {}) },
    data: { status: "cancelled" },
  });
}

async function lockOwnedItem(tx: Tx, actor: Actor, itemId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT pi."id" FROM purchase_item pi JOIN purchase p ON p."id" = pi."purchaseId"
     WHERE pi."id" = ${itemId} AND p."userId" = ${actor.id} FOR UPDATE OF pi`;
  if (!rows.length) throw notFound("Purchase item");
  return tx.purchaseItem.findUniqueOrThrow({ where: { id: itemId }, include: { purchase: true, deadline: true } });
}

/**
 * Confirm or change a return deadline. Increments the generation, cancels obsolete schedules,
 * and creates reminders only for future offsets (no burst of missed reminders).
 */
export async function setReturnDeadline(db: Db, config: AppConfig, now: Date, actor: Actor, itemId: string, raw: unknown) {
  const input = deadlineSchema.parse(raw);
  if (!isValidTimezone(input.timezone)) throw new AppError("VALIDATION_FAILED", "Unknown timezone", { fields: { timezone: "Choose a valid IANA timezone" } });
  let plan;
  try {
    plan = planReminders({ date: input.date, cutoffTime: input.cutoffTime ?? null, timezone: input.timezone }, now);
  } catch (e) {
    if (e instanceof DateRuleError) throw new AppError("VALIDATION_FAILED", e.message, { fields: { date: e.message } });
    throw e;
  }
  const result = await withTx(db, async (tx) => {
    const item = await lockOwnedItem(tx, actor, itemId);
    if (item.purchase.status !== "active") throw new AppError("UNSUPPORTED", "This purchase is cancelled.");
    if (item.status === "returned") throw new AppError("UNSUPPORTED", "This item is marked returned.");
    const existing = item.deadline && !item.deadline.removedAt ? item.deadline : null;
    if (input.expectedGeneration != null && existing && existing.generation !== input.expectedGeneration) {
      throw new AppError("VERSION_CONFLICT", "This return date changed elsewhere. Refresh before saving.");
    }
    const generation = (item.deadline?.generation ?? 0) + 1;
    const data = {
      userId: actor.id,
      date: input.date,
      cutoffTime: input.cutoffTime ?? null,
      timezone: input.timezone,
      source: input.source,
      confirmedAt: now,
      notes: input.notes ?? null,
      generation,
      removedAt: null,
    };
    const dl = item.deadline
      ? await tx.returnDeadline.update({ where: { id: item.deadline.id }, data })
      : await tx.returnDeadline.create({ data: { purchaseItemId: item.id, ...data } });
    await cancelSchedules(tx, dl.id, generation, "deadline_changed");
    for (const r of plan) {
      await tx.reminderSchedule.create({
        data: { deadlineId: dl.id, userId: actor.id, generation, offsetDays: r.offsetDays, dueAt: r.dueAt, localLabel: r.localLabel, status: r.status, createdAt: now },
      });
    }
    return { purchaseId: item.purchaseId, skippedPast: plan.filter((p) => p.status === "skipped_past").length };
  });
  void config;
  return { purchase: await purchaseDTO(db, result.purchaseId, actor.id), skippedPastReminders: result.skippedPast };
}

export async function removeReturnDeadline(db: Db, now: Date, actor: Actor, itemId: string) {
  const purchaseId = await withTx(db, async (tx) => {
    const item = await lockOwnedItem(tx, actor, itemId);
    if (item.deadline && !item.deadline.removedAt) {
      await tx.returnDeadline.update({ where: { id: item.deadline.id }, data: { removedAt: now, generation: { increment: 1 } } });
      await cancelSchedules(tx, item.deadline.id, null, "deadline_removed");
    }
    return item.purchaseId;
  });
  return purchaseDTO(db, purchaseId, actor.id);
}

export async function setItemStatus(db: Db, actor: Actor, itemId: string, status: "kept" | "returned") {
  const purchaseId = await withTx(db, async (tx) => {
    const item = await lockOwnedItem(tx, actor, itemId);
    await tx.purchaseItem.update({ where: { id: item.id }, data: { status } });
    if (status === "returned" && item.deadline) await cancelSchedules(tx, item.deadline.id, null, "item_returned");
    return item.purchaseId;
  });
  return purchaseDTO(db, purchaseId, actor.id);
}

// ── Reminder evaluation (worker) ──────────────────────────────────────────────────────────

export const REMINDER_LEASE_MS = 2 * 60_000;

/**
 * Claim due schedules, revalidate generation/status, and create a durable in-app event plus
 * an email delivery through the outbox. Idempotent per (deadline, generation, offset).
 */
export async function processDueReminders(db: Db, now: Date, limit = 100): Promise<{ sent: number; cancelled: number }> {
  const due = await db.reminderSchedule.findMany({
    where: {
      dueAt: { lte: now },
      OR: [{ status: "scheduled" }, { status: "claimed", leaseExpiresAt: { lt: now } }],
    },
    orderBy: [{ dueAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
  let sent = 0;
  let cancelled = 0;
  for (const { id } of due) {
    const r = await withTx(db, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM reminder_schedule WHERE "id" = ${id} AND ("status" = 'scheduled' OR ("status" = 'claimed' AND "leaseExpiresAt" < ${now})) FOR UPDATE SKIP LOCKED`;
      if (!rows.length) return "skip";
      const s = await tx.reminderSchedule.findUniqueOrThrow({ where: { id }, include: { deadline: { include: { purchaseItem: { include: { purchase: { include: { user: true } } } } } } } });
      const dl = s.deadline;
      const item = dl.purchaseItem;
      const user = item.purchase.user;
      const obsolete = dl.removedAt !== null || dl.generation !== s.generation || item.status !== "kept" || item.purchase.status !== "active" || user.deletionState !== "active";
      if (obsolete) {
        await tx.reminderSchedule.update({ where: { id }, data: { status: "cancelled", processedAt: now } });
        return "cancelled";
      }
      const logicalKey = `reminder:${dl.id}:g${s.generation}:d${s.offsetDays}`;
      const payload = {
        purchaseItemId: item.id,
        purchaseId: item.purchaseId,
        deadlineId: dl.id,
        generation: s.generation,
        description: item.description,
        date: dl.date,
        cutoffTime: dl.cutoffTime,
        timezone: dl.timezone,
        source: dl.source,
        offsetDays: s.offsetDays,
        headline: `Return date in ${s.offsetDays} day${s.offsetDays === 1 ? "" : "s"}: ${item.description}`,
      };
      let eventId: string | null = null;
      try {
        const e = await tx.notificationEvent.create({ data: { userId: user.id, type: "return_reminder", logicalKey, payload, isDemo: item.purchase.isDemo, createdAt: now } });
        eventId = e.id;
      } catch (err) {
        if ((err as { code?: string }).code !== "P2002") throw err;
      }
      if (eventId && user.emailReminders) {
        const d = await tx.notificationDelivery.create({ data: { eventId, channel: "email", notBefore: now, idempotencyKey: `dlv:${logicalKey}:email` } });
        await tx.outboxEvent.create({ data: { type: "notification.dispatch", entityKey: `delivery:${d.id}`, payload: { deliveryId: d.id }, availableAt: now, createdAt: now } });
      }
      await tx.reminderSchedule.update({ where: { id }, data: { status: "sent", processedAt: now, attempts: { increment: 1 } } });
      return "sent";
    });
    if (r === "sent") sent++;
    if (r === "cancelled") cancelled++;
  }
  return { sent, cancelled };
}

/**
 * Settings timezone change. Each deadline keeps the IANA zone it was confirmed in, because
 * the return cutoff belongs to the retailer's local date and not the user's location. Changing
 * the user's display timezone therefore leaves deadlines alone. A user who wants a different
 * zone for a deadline re-confirms it, which bumps the generation and reschedules.
 * This function exists so the settings flow has one explicit place to make that decision.
 */
export function deadlinesFollowConfirmedZone(): true {
  return true;
}
