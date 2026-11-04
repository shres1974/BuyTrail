/**
 * Route-handler plumbing: session → Actor, error envelope (Section 18), rate limiting,
 * JSON with bigint-safe serialization, body size limits, request IDs.
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError, type Actor } from "@buytrail/services";
import { auth } from "./auth";
import { services } from "./services";

export function requestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Resolve the authenticated actor from the session cookie. Never from client-supplied IDs. */
export async function currentActor(): Promise<Actor | null> {
  const h = await headers();
  const session = await auth().api.getSession({ headers: h });
  if (!session) return null;
  const u = await services().db.user.findUnique({ where: { id: session.user.id } });
  if (!u || u.deletionState !== "active") return null;
  return { id: u.id, email: u.email, role: u.role === "admin" ? "admin" : "user", timezone: u.timezone };
}

export async function requireActor(): Promise<Actor> {
  const a = await currentActor();
  if (!a) throw new AppError("UNAUTHENTICATED", "Sign in to continue.");
  return a;
}

const json = (body: unknown, init?: ResponseInit) =>
  new NextResponse(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    ...init,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(init?.headers ?? {}) },
  });

export function ok(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return json(body, { status, headers: extraHeaders });
}

export function errorResponse(e: unknown, reqId: string) {
  if (e instanceof AppError) {
    return json(
      {
        error: {
          code: e.code,
          message: e.message,
          requestId: reqId,
          retryable: e.extra.retryable ?? (e.status === 429 || e.status === 503),
          ...(e.extra.fields ? { fields: e.extra.fields } : {}),
          ...(e.extra.current !== undefined ? { current: e.extra.current } : {}),
        },
      },
      { status: e.status },
    );
  }
  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of e.issues) fields[i.path.join(".") || "_"] = i.message;
    return json({ error: { code: "VALIDATION_FAILED", message: "Please correct the highlighted fields.", requestId: reqId, retryable: false, fields } }, { status: 400 });
  }
  // Never return SQL details, keys or stack traces.
  services().log.error("unhandled route error", { requestId: reqId, error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
  return json({ error: { code: "INTERNAL", message: "Something went wrong. Try again.", requestId: reqId, retryable: true } }, { status: 500 });
}

/** Wrap a route handler with error mapping and a request ID. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    const id = requestId();
    try {
      const r = await fn(...args);
      r.headers.set("x-request-id", id);
      return r;
    } catch (e) {
      return errorResponse(e, id);
    }
  };
}

export const MAX_JSON_BYTES = 64 * 1024;

export async function readJson(req: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new AppError("VALIDATION_FAILED", "Request body too large");
  const text = await req.text();
  if (Buffer.byteLength(text) > maxBytes) throw new AppError("VALIDATION_FAILED", "Request body too large");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("VALIDATION_FAILED", "Malformed JSON");
  }
}

/** Origin check for state-changing requests (defence in depth beyond SameSite cookies). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const base = new URL(services().config.APP_BASE_URL).origin;
  if (origin && origin !== base) throw new AppError("FORBIDDEN", "Cross-origin request rejected");
}

// ── Fixed-window in-memory rate limiter (per process). Adequate for one web instance; ─────
// ── a multi-instance deployment should move this to Redis (documented limitation). ───────
const buckets = new Map<string, { n: number; reset: number }>();
export async function rateLimit(key: string, max: number, windowMs = 60_000) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    if (buckets.size > 50_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return;
  }
  b.n++;
  if (b.n > max) throw new AppError("RATE_LIMITED", "Too many requests. Wait a moment and try again.");
}

/**
 * Client identity for rate limiting. Forwarded headers are client-controlled unless a trusted
 * proxy overwrites them, so they are honoured only when TRUST_PROXY=true.
 */
export async function clientKey(): Promise<string> {
  if (!services().config.TRUST_PROXY) return "direct";
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown").slice(0, 64);
}
