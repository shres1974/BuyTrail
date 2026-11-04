"use client";
/**
 * Small client helpers: JSON fetch with the error envelope, idempotency keys.
 */
export type ApiError = { code: string; message: string; fields?: Record<string, string>; retryable?: boolean; current?: unknown; requestId?: string };

export class ApiFailure extends Error {
  constructor(public readonly error: ApiError, public readonly status: number) {
    super(error.message);
  }
}

export async function api<T>(url: string, init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers["content-type"] = "application/json";
  if (init.idempotencyKey) headers["idempotency-key"] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, credentials: "same-origin" });
  } catch {
    throw new ApiFailure({ code: "NETWORK", message: "Couldn't reach BuyTrail. Check your connection and try again.", retryable: true }, 0);
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiFailure(body?.error ?? { code: "HTTP_" + res.status, message: "Request failed" }, res.status);
  return body as T;
}

export function newIdempotencyKey(prefix: string): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now();
  return `${prefix}-${rnd}`;
}
