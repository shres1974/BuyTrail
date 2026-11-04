/**
 * Typed application errors mapped to the HTTP error envelope (Section 18).
 */
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "UNSUPPORTED"
  | "LIMIT_EXCEEDED"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "DEMO_RESTRICTION";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  UNSUPPORTED: 422,
  LIMIT_EXCEEDED: 422,
  DEMO_RESTRICTION: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly extra: { fields?: Record<string, string>; current?: unknown; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "AppError";
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export const notFound = (what = "Resource") => new AppError("NOT_FOUND", `${what} not found`);
