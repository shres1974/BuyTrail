/**
 * Request idempotency for retried creates (Section 18). Scoped to user + operation. Same key +
 * same request hash returns the original outcome; same key + different body is a conflict (G26).
 */
import { isUniqueViolation, type Db, type Tx } from "@buytrail/db";
import { canonicalJson, sha256 } from "@buytrail/domain";
import { AppError } from "./errors";

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;

export type IdemBegin = { kind: "new"; recordId: string } | { kind: "replay"; responseRef: string | null };

export async function beginIdempotent(tx: Tx, userId: string, operation: string, key: string, body: unknown, now: Date): Promise<IdemBegin> {
  if (!/^[A-Za-z0-9_\-:.]{8,128}$/.test(key)) throw new AppError("VALIDATION_FAILED", "Idempotency-Key must be 8–128 URL-safe characters");
  const requestHash = sha256(canonicalJson(body));
  // Lock the key row if present so concurrent retries serialize.
  const existing = await tx.$queryRaw<Array<{ id: string; requestHash: string; responseRef: string | null; expiresAt: Date }>>`
    SELECT "id", "requestHash", "responseRef", "expiresAt" FROM idempotency_record
     WHERE "userId" = ${userId} AND "operation" = ${operation} AND "key" = ${key} FOR UPDATE`;
  const e = existing[0];
  if (e && e.expiresAt > now) {
    if (e.requestHash !== requestHash) {
      throw new AppError("IDEMPOTENCY_CONFLICT", "This Idempotency-Key was already used with a different request.");
    }
    return { kind: "replay", responseRef: e.responseRef };
  }
  if (e) await tx.idempotencyRecord.delete({ where: { id: e.id } });
  try {
    const r = await tx.idempotencyRecord.create({
      data: { userId, operation, key, requestHash, expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) },
    });
    return { kind: "new", recordId: r.id };
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("IDEMPOTENCY_CONFLICT", "A request with this Idempotency-Key is in progress; retry shortly.", { retryable: true });
    throw err;
  }
}

export async function finishIdempotent(tx: Tx, recordId: string, responseRef: string, status: number): Promise<void> {
  await tx.idempotencyRecord.update({ where: { id: recordId }, data: { responseRef, responseStatus: status } });
}

export async function purgeExpiredIdempotency(db: Db, now: Date): Promise<number> {
  const r = await db.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: now } } });
  return r.count;
}
