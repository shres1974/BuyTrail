/**
 * Private receipt handling (Section 23).
 *
 * Flow: upload intent (owner check, unpredictable key, size/type limits, short expiry) →
 * client PUTs bytes to the authenticated BuyTrail upload endpoint (bound to the intent, which
 * writes to quarantine) → confirm (object exists, size matches) → worker validates actual
 * content within limits → ready (moved out of quarantine) or rejected.
 *
 * Demo mode (G30): arbitrary uploads are refused; only bundled synthetic receipts may be
 * attached via attachSampleReceipt, which runs the same validation pipeline.
 *
 * Downloads stream through an authenticated route after an owner check, so revocation is
 * immediate (no long-lived signed URLs are issued).
 */
import { randomBytes } from "node:crypto";
import { withTx, type Db, type Tx } from "@buytrail/db";
import { sha256 } from "@buytrail/domain";
import type { AppConfig } from "@buytrail/config";
import { z } from "zod";
import type { Actor } from "./auth-types";
import { AppError, notFound } from "./errors";
import { enqueueOutbox } from "./outbox";
import type { ObjectStore } from "./storage";

export const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type ReceiptType = (typeof ALLOWED_TYPES)[number];
export const UPLOAD_INTENT_TTL_MS = 10 * 60_000;
export const MAX_IMAGE_PIXELS = 40_000_000; // decompression-bomb guard
export const MAX_IMAGE_DIMENSION = 12_000;

export const uploadIntentSchema = z.object({
  purchaseId: z.string().min(1).max(100),
  contentType: z.enum(ALLOWED_TYPES),
  size: z.number().int().min(1),
});

const newKey = (prefix: string, userId: string) => `${prefix}/${sha256(userId).slice(0, 16)}/${randomBytes(24).toString("base64url")}`;

async function ownedPurchase(db: Db, actor: Actor, purchaseId: string) {
  const p = await db.purchase.findFirst({ where: { id: purchaseId, userId: actor.id } });
  if (!p) throw notFound("Purchase");
  return p;
}

async function checkQuotas(db: Db, config: AppConfig, actor: Actor, purchaseId: string, size: number) {
  if (size > config.RECEIPT_MAX_BYTES) throw new AppError("LIMIT_EXCEEDED", `Receipts can be at most ${Math.floor(config.RECEIPT_MAX_BYTES / 1048576)} MiB.`);
  const count = await db.receipt.count({ where: { purchaseId, state: { notIn: ["deleted", "deleting", "rejected", "failed"] } } });
  if (count >= config.RECEIPTS_PER_PURCHASE) throw new AppError("LIMIT_EXCEEDED", `A purchase can have at most ${config.RECEIPTS_PER_PURCHASE} receipts.`);
  const used = await db.receipt.aggregate({ _sum: { declaredSize: true }, where: { userId: actor.id, state: { notIn: ["deleted", "rejected", "failed"] } } });
  if ((used._sum.declaredSize ?? 0) + size > config.ACCOUNT_STORAGE_QUOTA_BYTES) throw new AppError("LIMIT_EXCEEDED", "Your receipt storage quota is full.");
}

export function realUploadsAllowed(config: AppConfig): boolean {
  return config.APP_MODE !== "demo" && (config.REAL_RECEIPT_UPLOADS_ENABLED || config.APP_MODE === "local");
}

export async function createUploadIntent(db: Db, config: AppConfig, now: Date, actor: Actor, raw: unknown) {
  if (!realUploadsAllowed(config)) {
    throw new AppError("DEMO_RESTRICTION", "File uploads are disabled in this demonstration. Use “Attach a sample receipt” instead — please don't upload real receipts here.");
  }
  const input = uploadIntentSchema.parse(raw);
  await ownedPurchase(db, actor, input.purchaseId);
  await checkQuotas(db, config, actor, input.purchaseId, input.size);
  const r = await db.receipt.create({
    data: {
      userId: actor.id,
      purchaseId: input.purchaseId,
      objectKey: newKey("quarantine", actor.id),
      declaredType: input.contentType,
      declaredSize: input.size,
      state: "pending",
      uploadExpiresAt: new Date(now.getTime() + UPLOAD_INTENT_TTL_MS),
      createdAt: now,
    },
  });
  // The client uploads to our authenticated endpoint; the object key never leaves the server.
  return { receiptId: r.id, uploadUrl: `/api/receipts/${r.id}/content`, method: "PUT", maxBytes: input.size, contentType: input.contentType, expiresAt: r.uploadExpiresAt.toISOString() };
}

/** Accept bytes for an intent. Bound to intent ID + owner; size must match exactly (G22). */
export async function receiveUpload(db: Db, config: AppConfig, storage: ObjectStore, now: Date, actor: Actor, receiptId: string, body: Buffer, contentType: string | null) {
  if (!realUploadsAllowed(config)) throw new AppError("DEMO_RESTRICTION", "File uploads are disabled in this demonstration.");
  const r = await db.receipt.findFirst({ where: { id: receiptId, userId: actor.id } });
  if (!r) throw notFound("Receipt");
  if (r.state !== "pending") throw new AppError("UNSUPPORTED", "This upload has already been received.");
  if (r.uploadExpiresAt < now) throw new AppError("UNSUPPORTED", "This upload intent has expired. Start again.");
  if (contentType && contentType.split(";")[0]!.trim() !== r.declaredType) throw new AppError("VALIDATION_FAILED", "Content type does not match the upload intent.");
  if (body.length !== r.declaredSize) throw new AppError("VALIDATION_FAILED", "Uploaded size does not match the upload intent.");
  await storage.put(r.objectKey, body, "application/octet-stream");
  return { receiptId: r.id };
}

export async function confirmUpload(db: Db, storage: ObjectStore, now: Date, actor: Actor, receiptId: string) {
  const r = await db.receipt.findFirst({ where: { id: receiptId, userId: actor.id } });
  if (!r) throw notFound("Receipt");
  if (r.state !== "pending") return receiptDTO(r);
  const head = await storage.head(r.objectKey);
  if (!head) throw new AppError("VALIDATION_FAILED", "No uploaded file was found for this receipt.");
  if (head.size !== r.declaredSize) {
    await db.receipt.update({ where: { id: r.id }, data: { state: "rejected", rejectReason: "size_mismatch", actualSize: head.size } });
    throw new AppError("VALIDATION_FAILED", "Uploaded size does not match.");
  }
  const updated = await withTx(db, async (tx) => {
    const u = await tx.receipt.update({ where: { id: r.id }, data: { state: "processing", actualSize: head.size } });
    await enqueueOutbox(tx, "receipt.validate", `receipt:${r.id}`, { receiptId: r.id }, now);
    return u;
  });
  return receiptDTO(updated);
}

/** Demo-safe path: attach a bundled synthetic receipt; same validation pipeline. */
export async function attachSampleReceipt(db: Db, config: AppConfig, storage: ObjectStore, now: Date, actor: Actor, purchaseId: string, sample: { bytes: Buffer; contentType: ReceiptType }) {
  await ownedPurchase(db, actor, purchaseId);
  await checkQuotas(db, config, actor, purchaseId, sample.bytes.length);
  const key = newKey("quarantine", actor.id);
  await storage.put(key, sample.bytes, "application/octet-stream");
  const r = await withTx(db, async (tx) => {
    const created = await tx.receipt.create({
      data: {
        userId: actor.id,
        purchaseId,
        objectKey: key,
        declaredType: sample.contentType,
        declaredSize: sample.bytes.length,
        actualSize: sample.bytes.length,
        state: "processing",
        isSynthetic: true,
        uploadExpiresAt: now,
        createdAt: now,
      },
    });
    await enqueueOutbox(tx, "receipt.validate", `receipt:${created.id}`, { receiptId: created.id }, now);
    return created;
  });
  return receiptDTO(r);
}

type ReceiptRow = Awaited<ReturnType<Db["receipt"]["findFirstOrThrow"]>>;
export function receiptDTO(r: ReceiptRow) {
  return { id: r.id, purchaseId: r.purchaseId, state: r.state, declaredType: r.declaredType, size: r.actualSize ?? r.declaredSize, rejectReason: r.rejectReason, isSynthetic: r.isSynthetic, createdAt: r.createdAt.toISOString() };
}

// ── Content validation (worker) ─────────────────────────────────────────────────────────────

export type Sniffed = { type: ReceiptType } | { type: null; reason: string };

/** Magic-byte detection; never trust extension or declared MIME. */
export function sniffType(b: Buffer): Sniffed {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: "image/jpeg" };
  if (b.length >= 5 && b.subarray(0, 5).toString("latin1") === "%PDF-") return { type: "application/pdf" };
  return { type: null, reason: "unrecognized_file_signature" };
}

/**
 * Structural PDF scan (builtin-structural scanner). Rejects active content: JavaScript, launch
 * actions, embedded files, XFA forms, auto-open actions, and remote GoTo/URI fetches on open.
 * This is a conservative heuristic, not a malware scanner; see docs/security-model.md.
 */
export function scanPdf(b: Buffer): { ok: true } | { ok: false; reason: string } {
  const s = b.toString("latin1");
  if (!/%%EOF\s*$/.test(s.slice(-1024))) return { ok: false, reason: "pdf_truncated" };
  const banned: Array<[RegExp, string]> = [
    [/\/JavaScript\b|\/JS\b/, "pdf_javascript"],
    [/\/Launch\b/, "pdf_launch_action"],
    [/\/EmbeddedFile\b/, "pdf_embedded_file"],
    [/\/XFA\b/, "pdf_xfa_form"],
    [/\/OpenAction\b/, "pdf_open_action"],
    [/\/AA\b/, "pdf_additional_actions"],
    [/\/GoToR\b|\/SubmitForm\b|\/ImportData\b/, "pdf_remote_action"],
    [/\/RichMedia\b/, "pdf_rich_media"],
  ];
  for (const [re, reason] of banned) if (re.test(s)) return { ok: false, reason };
  // Obfuscated names using #xx hex escapes (e.g. /J#61vaScript) are rejected outright.
  if (/\/[A-Za-z]*#[0-9A-Fa-f]{2}/.test(s)) return { ok: false, reason: "pdf_obfuscated_names" };
  return { ok: true };
}

export async function validateReceipt(db: Db, config: AppConfig, storage: ObjectStore, receiptId: string, now: Date): Promise<string> {
  const r = await db.receipt.findUnique({ where: { id: receiptId }, include: { user: true } });
  if (!r) return "missing";
  if (r.state !== "processing") return `skip_${r.state}`;
  if (r.user.deletionState !== "active") return "owner_deleted";
  const reject = async (reason: string) => {
    await db.receipt.update({ where: { id: r.id }, data: { state: "rejected", rejectReason: reason } });
    await scheduleObjectDeletion(db, r.objectKey, now);
    return `rejected:${reason}`;
  };
  if (config.RECEIPT_SCANNER === "none" && !r.isSynthetic) return "pending_no_scanner"; // stays processing; never marked ready unvalidated
  const bytes = await storage.get(r.objectKey, config.RECEIPT_MAX_BYTES);
  if (!bytes) {
    await db.receipt.update({ where: { id: r.id }, data: { state: "failed", rejectReason: "object_missing" } });
    return "failed:object_missing";
  }
  if (bytes.length !== r.declaredSize) return reject("size_mismatch");
  const sniffed = sniffType(bytes);
  if (!sniffed.type) return reject(sniffed.reason);
  if (sniffed.type !== r.declaredType) return reject("type_mismatch");
  let previewKey: string | null = null;
  if (sniffed.type === "application/pdf") {
    const scan = scanPdf(bytes);
    if (!scan.ok) return reject(scan.reason);
  } else {
    // Decode within limits and re-encode a safe preview (strips metadata).
    const { default: sharp } = await import("sharp");
    try {
      const img = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error", sequentialRead: true });
      const meta = await img.metadata();
      if (!meta.width || !meta.height || meta.width > MAX_IMAGE_DIMENSION || meta.height > MAX_IMAGE_DIMENSION) return reject("image_dimensions_out_of_bounds");
      if ((meta.pages ?? 1) > 1) return reject("multi_frame_image");
      const preview = await sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate().resize({ width: 800, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
      previewKey = newKey("previews", r.userId);
      await storage.put(previewKey, preview, "image/jpeg");
    } catch {
      return reject("image_decode_failed");
    }
  }
  // Move out of quarantine.
  const readyKey = newKey("receipts", r.userId);
  await storage.put(readyKey, bytes, "application/octet-stream");
  const res = await db.receipt.updateMany({
    where: { id: r.id, state: "processing" },
    data: { state: "ready", readyKey, previewKey, detectedType: sniffed.type, checksum: sha256(bytes), actualSize: bytes.length },
  });
  if (res.count === 0) {
    // Deleted concurrently: clean up what we just wrote.
    await scheduleObjectDeletion(db, readyKey, now);
    if (previewKey) await scheduleObjectDeletion(db, previewKey, now);
    return "deleted_during_processing";
  }
  await scheduleObjectDeletion(db, r.objectKey, now);
  return "ready";
}

/** Owner-checked download. Returns null-safe 404 for other users (G21). */
export async function downloadReceipt(db: Db, config: AppConfig, storage: ObjectStore, actor: Actor, receiptId: string, variant: "original" | "preview") {
  const r = await db.receipt.findFirst({ where: { id: receiptId, userId: actor.id, state: "ready" } });
  if (!r) throw notFound("Receipt");
  const key = variant === "preview" ? r.previewKey : r.readyKey;
  if (!key) throw notFound("Receipt preview");
  const bytes = await storage.get(key, config.RECEIPT_MAX_BYTES);
  if (!bytes) throw notFound("Receipt");
  return { bytes, contentType: variant === "preview" ? "image/jpeg" : (r.detectedType ?? r.declaredType) };
}

export async function deleteReceipt(db: Db, now: Date, actor: Actor, receiptId: string) {
  await withTx(db, async (tx) => {
    const r = await tx.receipt.findFirst({ where: { id: receiptId, userId: actor.id, state: { not: "deleted" } } });
    if (!r) throw notFound("Receipt");
    await tx.receipt.update({ where: { id: r.id }, data: { state: "deleted", readyKey: null, previewKey: null } });
    for (const k of [r.objectKey, r.readyKey, r.previewKey]) if (k) await scheduleObjectDeletion(tx, k, now);
  });
}

/** Durable, retryable object deletion obligation. */
export async function scheduleObjectDeletion(db: Db | Tx, key: string, now: Date) {
  await db.deletionTask.upsert({
    where: { kind_target: { kind: "object", target: key } },
    create: { kind: "object", target: key, nextAttemptAt: now, createdAt: now },
    update: { state: "pending", nextAttemptAt: now },
  });
}

export async function processDeletionTasks(db: Db, storage: ObjectStore, now: Date, limit = 100) {
  const tasks = await db.deletionTask.findMany({ where: { kind: "object", state: "pending", nextAttemptAt: { lte: now } }, take: limit });
  let done = 0;
  for (const t of tasks) {
    try {
      await storage.delete(t.target);
      await db.deletionTask.update({ where: { id: t.id }, data: { state: "done", lastError: null } });
      done++;
    } catch (e) {
      await db.deletionTask.update({
        where: { id: t.id },
        data: { attempts: { increment: 1 }, lastError: String((e as Error).message).slice(0, 300), nextAttemptAt: new Date(now.getTime() + Math.min(3600_000, 30_000 * 2 ** t.attempts)) },
      });
    }
  }
  return done;
}
