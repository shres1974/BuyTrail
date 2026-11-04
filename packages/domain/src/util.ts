/**
 * Small utilities: clock injection, retry backoff, stable hashing, cursors.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export class FakeClock implements Clock {
  constructor(private t: Date) {}
  now(): Date {
    return new Date(this.t.getTime());
  }
  set(d: Date): void {
    this.t = new Date(d.getTime());
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}

/** Exponential backoff with full jitter, honouring provider Retry-After when larger. */
export function backoffMs(attempt: number, opts: { baseMs?: number; maxMs?: number; retryAfterMs?: number | null; random?: () => number } = {}): number {
  const base = opts.baseMs ?? 1000;
  const max = opts.maxMs ?? 15 * 60_000;
  const rnd = opts.random ?? Math.random;
  const exp = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  const jittered = Math.floor(exp / 2 + rnd() * (exp / 2));
  return Math.max(jittered, opts.retryAfterMs ?? 0);
}

/** Deterministic JSON (sorted keys) for request hashing; bigint serialized as string. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (typeof v === "bigint") return v.toString();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  });
}

export function sha256(s: string | Buffer): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Signed opaque cursor bound to a query signature (Section 14). */
export function encodeCursor(payload: { sig: string; key: unknown[] }, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(body).digest("base64url").slice(0, 22);
  return `${body}.${mac}`;
}

export function decodeCursor(cursor: string, expectedSig: string, secret: string): unknown[] | null {
  const [body, mac] = cursor.split(".");
  if (!body || !mac || cursor.length > 2048) return null;
  const expected = createHmac("sha256", secret).update(body).digest("base64url").slice(0, 22);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as { sig: string; key: unknown[] };
    if (p.sig !== expectedSig || !Array.isArray(p.key)) return null;
    return p.key;
  } catch {
    return null;
  }
}

/** Neutralize spreadsheet formula injection for CSV export cells. */
export function csvSafeCell(v: string): string {
  const needsPrefix = /^[=+\-@\t\r]/.test(v);
  const s = needsPrefix ? `'${v}` : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
