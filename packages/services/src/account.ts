/**
 * Account settings, export and durable deletion (Section 25.4).
 */
import { zipSync, strToU8 } from "fflate";
import { withTx, type Db } from "@buytrail/db";
import { canonicalJson, isValidTimezone, sha256, CATEGORY_KEYS } from "@buytrail/domain";
import type { AppConfig } from "@buytrail/config";
import { z } from "zod";
import type { Actor } from "./auth-types";
import { AppError, notFound } from "./errors";
import { enqueueOutbox } from "./outbox";
import { listPurchases } from "./purchases";
import { scheduleObjectDeletion } from "./receipts";
import type { ObjectStore } from "./storage";
import { randomBytes } from "node:crypto";

export const settingsSchema = z.object({
  version: z.number().int().min(1),
  timezone: z.string().max(64).optional(),
  emailAlerts: z.boolean().optional(),
  emailReminders: z.boolean().optional(),
  categoryEmailOptOut: z.array(z.enum(CATEGORY_KEYS as [string, ...string[]])).max(10).optional(),
});

export async function getSettings(db: Db, actor: Actor) {
  const u = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  return {
    version: u.settingsVersion,
    email: u.email,
    timezone: u.timezone,
    emailAlerts: u.emailAlerts,
    emailReminders: u.emailReminders,
    categoryEmailOptOut: u.categoryEmailOptOut,
    role: u.role,
  };
}

export async function updateSettings(db: Db, actor: Actor, raw: unknown) {
  const input = settingsSchema.parse(raw);
  if (input.timezone && !isValidTimezone(input.timezone)) throw new AppError("VALIDATION_FAILED", "Unknown timezone", { fields: { timezone: "Choose a valid IANA timezone" } });
  const r = await db.user.updateMany({
    where: { id: actor.id, settingsVersion: input.version },
    data: {
      ...(input.timezone ? { timezone: input.timezone } : {}),
      ...(input.emailAlerts !== undefined ? { emailAlerts: input.emailAlerts } : {}),
      ...(input.emailReminders !== undefined ? { emailReminders: input.emailReminders } : {}),
      ...(input.categoryEmailOptOut ? { categoryEmailOptOut: input.categoryEmailOptOut } : {}),
      settingsVersion: { increment: 1 },
    },
  });
  if (r.count === 0) throw new AppError("VERSION_CONFLICT", "Settings changed in another tab. Refresh before saving.", { current: await getSettings(db, actor) });
  return getSettings(db, actor);
}

// ── Export ─────────────────────────────────────────────────────────────────────────────────

export const EXPORT_TTL_MS = 24 * 3600_000;

export async function requestExport(db: Db, now: Date, actor: Actor) {
  const recent = await db.accountExport.count({ where: { userId: actor.id, createdAt: { gt: new Date(now.getTime() - 3600_000) } } });
  if (recent >= 3) throw new AppError("RATE_LIMITED", "You can request up to 3 exports per hour.");
  return withTx(db, async (tx) => {
    const e = await tx.accountExport.create({ data: { userId: actor.id, createdAt: now } });
    await enqueueOutbox(tx, "account.export", `export:${e.id}`, { exportId: e.id }, now);
    return { id: e.id, state: e.state };
  });
}

export async function buildExport(db: Db, storage: ObjectStore, now: Date, exportId: string, maxReceiptBytes: number) {
  const e = await db.accountExport.findUnique({ where: { id: exportId }, include: { user: true } });
  if (!e || e.state !== "pending") return "skip";
  if (e.user.deletionState !== "active") return "owner_deleted";
  const actor: Actor = { id: e.userId, email: e.user.email, role: e.user.role as "user", timezone: e.user.timezone };
  const watches = await db.watch.findMany({ where: { userId: e.userId, lifecycle: { not: "deleted" } } });
  const purchases = await listPurchases(db, actor, null, 100);
  const notifications = await db.notificationEvent.findMany({ where: { userId: e.userId }, orderBy: { createdAt: "asc" } });
  const settings = await getSettings(db, actor);
  const files: Record<string, Uint8Array> = {
    "README.txt": strToU8("BuyTrail account export. Money amounts are integer minor units (cents) as strings. Dates are local calendar dates unless suffixed with Z.\n"),
    "settings.json": strToU8(JSON.stringify({ ...settings, role: undefined }, null, 2)),
    "watches.json": strToU8(canonicalJson(watches.map((w) => ({ id: w.id, variantId: w.variantId, condition: w.condition, target: { amountMinor: w.targetMinor.toString(), currency: w.currency }, channels: w.channels, lifecycle: w.lifecycle, createdAt: w.createdAt })))),
    "purchases.json": strToU8(JSON.stringify(purchases, null, 2)),
    "notifications.json": strToU8(JSON.stringify(notifications.map((n) => ({ type: n.type, createdAt: n.createdAt, payload: n.payload })), null, 2)),
  };
  const receipts = await db.receipt.findMany({ where: { userId: e.userId, state: "ready" } });
  for (const r of receipts) {
    if (!r.readyKey) continue;
    const b = await storage.get(r.readyKey, maxReceiptBytes);
    if (b) files[`receipts/${r.id}.${r.detectedType === "application/pdf" ? "pdf" : r.detectedType === "image/png" ? "png" : "jpg"}`] = new Uint8Array(b);
  }
  const zip = Buffer.from(zipSync(files, { level: 6 }));
  const key = `exports/${sha256(e.userId).slice(0, 16)}/${randomBytes(24).toString("base64url")}.zip`;
  await storage.put(key, zip, "application/zip");
  await db.accountExport.update({ where: { id: e.id }, data: { state: "ready", objectKey: key, expiresAt: new Date(now.getTime() + EXPORT_TTL_MS) } });
  return "ready";
}

export async function listExports(db: Db, now: Date, actor: Actor) {
  const xs = await db.accountExport.findMany({ where: { userId: actor.id }, orderBy: { createdAt: "desc" }, take: 10 });
  return xs.map((x) => ({ id: x.id, state: x.expiresAt && x.expiresAt < now ? "expired" : x.state, createdAt: x.createdAt.toISOString(), expiresAt: x.expiresAt?.toISOString() ?? null }));
}

export async function downloadExport(db: Db, storage: ObjectStore, now: Date, actor: Actor, id: string) {
  const x = await db.accountExport.findFirst({ where: { id, userId: actor.id, state: "ready" } });
  if (!x || !x.objectKey || !x.expiresAt || x.expiresAt < now) throw notFound("Export");
  const b = await storage.get(x.objectKey, 512 * 1024 * 1024);
  if (!b) throw notFound("Export");
  return b;
}

export async function expireExports(db: Db, now: Date) {
  const xs = await db.accountExport.findMany({ where: { state: "ready", expiresAt: { lt: now } } });
  for (const x of xs) {
    if (x.objectKey) await scheduleObjectDeletion(db, x.objectKey, now);
    await db.accountExport.update({ where: { id: x.id }, data: { state: "expired", objectKey: null } });
  }
  return xs.length;
}

// ── Deletion ───────────────────────────────────────────────────────────────────────────────

/**
 * Begin deletion: revoke sessions, block new work, cancel deliveries, and record a durable
 * task. Idempotent: repeated calls are safe (G24).
 */
export async function beginAccountDeletion(db: Db, now: Date, userId: string) {
  await withTx(db, async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId } });
    if (!u) return;
    if (u.deletionState === "active") {
      await tx.user.update({ where: { id: userId }, data: { deletionState: "deleting", deletionRequestedAt: now } });
    }
    await tx.session.deleteMany({ where: { userId } });
    await tx.watch.updateMany({ where: { userId, lifecycle: { not: "deleted" } }, data: { lifecycle: "deleted" } });
    await tx.notificationDelivery.updateMany({ where: { event: { userId }, state: { in: ["pending", "retryable_failure", "claimed"] }, sendStartedAt: null }, data: { state: "cancelled", suppressedReason: "account_deleted" } });
    await tx.reminderSchedule.updateMany({ where: { userId, status: { in: ["scheduled", "claimed"] } }, data: { status: "cancelled" } });
    await tx.deletionTask.upsert({ where: { kind_target: { kind: "account", target: userId } }, create: { kind: "account", target: userId, nextAttemptAt: now, createdAt: now }, update: { state: "pending", nextAttemptAt: now } });
    await enqueueOutbox(tx, "account.delete", `account:${userId}`, { userId }, now);
  });
}

/** Worker step: remove objects and personal records, then leave only a hashed tombstone. */
export async function completeAccountDeletion(db: Db, now: Date, userId: string) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (!u) {
    await db.deletionTask.updateMany({ where: { kind: "account", target: userId }, data: { state: "done" } });
    return "already_deleted";
  }
  if (u.deletionState === "active") return "not_requested";
  const receipts = await db.receipt.findMany({ where: { userId } });
  const exports = await db.accountExport.findMany({ where: { userId } });
  await withTx(db, async (tx) => {
    for (const r of receipts) for (const k of [r.objectKey, r.readyKey, r.previewKey]) if (k) await scheduleObjectDeletion(tx, k, now);
    for (const x of exports) if (x.objectKey) await scheduleObjectDeletion(tx, x.objectKey, now);
    await tx.deletionTombstone.upsert({ where: { subjectHash: sha256(userId) }, create: { subjectHash: sha256(userId), deletedAt: now }, update: {} });
    await tx.auditEvent.create({ data: { actorId: null, action: "account.deleted", resource: `user:${sha256(userId).slice(0, 16)}`, metadata: {} } });
    // Cascades remove sessions, watches, events, deliveries, purchases, items, deadlines,
    // schedules, receipts rows, private contexts, idempotency records and exports.
    await tx.user.delete({ where: { id: userId } });
    await tx.deletionTask.updateMany({ where: { kind: "account", target: userId }, data: { state: "done" } });
  });
  return "deleted";
}

/** Reconcile a restored backup against tombstones: re-delete resurrected accounts. */
export async function reconcileTombstones(db: Db, now: Date) {
  const tombs = new Set((await db.deletionTombstone.findMany({ select: { subjectHash: true } })).map((t) => t.subjectHash));
  if (!tombs.size) return 0;
  const users = await db.user.findMany({ select: { id: true } });
  let n = 0;
  for (const u of users) {
    if (tombs.has(sha256(u.id))) {
      await beginAccountDeletion(db, now, u.id);
      n++;
    }
  }
  return n;
}

export async function grantAdmin(db: Db, email: string) {
  const u = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!u) throw notFound("User");
  await db.user.update({ where: { id: u.id }, data: { role: "admin" } });
  await db.auditEvent.create({ data: { actorId: null, action: "admin.granted", resource: `user:${u.id}`, metadata: { via: "admin-grant" } } });
}

export function adminEmailMatch(config: AppConfig, email: string) {
  return config.APP_MODE !== "live" && config.adminEmails.includes(email.toLowerCase());
}
