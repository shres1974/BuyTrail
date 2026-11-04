import { z } from "zod";

/**
 * Validated environment configuration shared by web, worker and scripts.
 * Every process calls loadConfig() at startup; invalid configuration fails fast.
 */

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const intWithCeiling = (def: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const configSchema = z.object({
  APP_MODE: z.enum(["demo", "local", "live"]).default("demo"),
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),
  AUTH_SECRET: z.string().min(16),
  EMAIL_MODE: z.enum(["local", "disabled", "smtp"]).default("local"),
  EMAIL_FROM: z.string().default("BuyTrail <no-reply@buytrail.local>"),
  EMAIL_TEST_ALLOWLIST: z.string().default(""),
  /**
   * Comma-separated emails (or "@domain" entries) allowed to receive sign-in links.
   * Empty = anyone. Required for any public deployment that sends real email.
   */
  SIGNIN_ALLOWLIST: z.string().default(""),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAILPIT_API_URL: z.string().default("http://localhost:8025"),
  OBJECT_STORAGE_ENDPOINT: z.string().url().default("http://localhost:9000"),
  OBJECT_STORAGE_REGION: z.string().default("us-east-1"),
  OBJECT_STORAGE_BUCKET: z.string().min(3).default("buytrail-private"),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
  OBJECT_STORAGE_FORCE_PATH_STYLE: bool.default(true),
  LIVE_PROVIDERS_ENABLED: bool.default(false),
  AI_FEATURES_ENABLED: bool.default(false),
  REAL_RECEIPT_UPLOADS_ENABLED: bool.default(false),
  RECEIPT_SCANNER: z.enum(["builtin-structural", "none"]).default("builtin-structural"),
  DEMO_CLOCK_START: z.string().datetime({ offset: true }).optional(),
  // Product limits (Section 31). Ceilings prevent accidental unbounded configuration.
  MAX_ACTIVE_WATCHES_PER_USER: intWithCeiling(50, 1, 500),
  RECEIPT_MAX_BYTES: intWithCeiling(10 * 1024 * 1024, 1024, 25 * 1024 * 1024),
  RECEIPTS_PER_PURCHASE: intWithCeiling(5, 1, 20),
  ACCOUNT_STORAGE_QUOTA_BYTES: intWithCeiling(100 * 1024 * 1024, 1024 * 1024, 2 * 1024 * 1024 * 1024),
  PRICE_ALERT_EMAIL_COOLDOWN_HOURS: intWithCeiling(24, 0, 24 * 14),
  DEFAULT_FRESHNESS_SECONDS: intWithCeiling(6 * 3600, 60, 7 * 24 * 3600),
  SEARCH_RATE_LIMIT_PER_MINUTE: intWithCeiling(120, 1, 10000),
  EMAIL_GLOBAL_LIMIT_PER_HOUR: intWithCeiling(500, 1, 100000),
  EMAIL_USER_LIMIT_PER_DAY: intWithCeiling(30, 1, 1000),
  ADMIN_EMAILS: z.string().default(""),
  /** Trust X-Forwarded-For for client identity (rate limits). Only behind a trusted proxy. */
  TRUST_PROXY: bool.default(false),
});

export type AppConfig = z.infer<typeof configSchema> & {
  adminEmails: string[];
  emailAllowlist: string[];
  signinAllowlist: string[];
};

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n - ${problems.join("\n - ")}`);
  }
}

/** Values that must never be used outside local development. */
const LOCAL_ONLY_MARKERS = ["local_only", "replace_with", "changeme", "dev-secret"];

export function parseConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = configSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const c = parsed.data;
  const problems: string[] = [];

  if (c.APP_MODE === "live") {
    for (const [k, v] of [
      ["AUTH_SECRET", c.AUTH_SECRET],
      ["OBJECT_STORAGE_SECRET_KEY", c.OBJECT_STORAGE_SECRET_KEY],
      ["OBJECT_STORAGE_ACCESS_KEY", c.OBJECT_STORAGE_ACCESS_KEY],
      ["DATABASE_URL", c.DATABASE_URL],
    ] as const) {
      if (LOCAL_ONLY_MARKERS.some((m) => v.includes(m))) {
        problems.push(`${k} contains a local-only value; refusing to start in live mode`);
      }
    }
    if (!c.APP_BASE_URL.startsWith("https://")) {
      problems.push("APP_BASE_URL must use https in live mode");
    }
    if (c.EMAIL_MODE === "local") {
      problems.push("EMAIL_MODE=local is not allowed in live mode");
    }
    if (c.REAL_RECEIPT_UPLOADS_ENABLED && c.RECEIPT_SCANNER === "none") {
      problems.push("Real receipt uploads require a configured RECEIPT_SCANNER in live mode");
    }
    if (c.AUTH_SECRET.length < 32) {
      problems.push("AUTH_SECRET must be at least 32 characters in live mode");
    }
  }
  if (c.APP_MODE === "demo" && c.REAL_RECEIPT_UPLOADS_ENABLED) {
    problems.push("REAL_RECEIPT_UPLOADS_ENABLED cannot be true in demo mode (G30)");
  }
  if (c.APP_MODE === "demo" && c.LIVE_PROVIDERS_ENABLED) {
    problems.push("LIVE_PROVIDERS_ENABLED cannot be true in demo mode");
  }
  // A publicly reachable deployment that sends real email must not let anyone on the internet
  // trigger messages from the operator's mail account (Section 21.3: demo restricted to allowlist).
  if (c.EMAIL_MODE === "smtp" && c.APP_BASE_URL.startsWith("https://") && c.APP_MODE !== "live" && !c.SIGNIN_ALLOWLIST.trim()) {
    problems.push("SIGNIN_ALLOWLIST must be set for a public demo deployment that sends real email");
  }
  if (c.AI_FEATURES_ENABLED) {
    problems.push("AI_FEATURES_ENABLED=true but no AI provider is implemented; keep it false");
  }
  if (problems.length) throw new ConfigError(problems);

  const split = (s: string) =>
    s
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  return { ...c, adminEmails: split(c.ADMIN_EMAILS), emailAllowlist: split(c.EMAIL_TEST_ALLOWLIST), signinAllowlist: split(c.SIGNIN_ALLOWLIST) };
}

/** Exact address or "@domain" match; an empty list allows everyone. */
export function emailAllowed(list: string[], email: string): boolean {
  if (list.length === 0) return true;
  const e = email.trim().toLowerCase();
  const domain = e.slice(e.lastIndexOf("@"));
  return list.some((x) => x === e || (x.startsWith("@") && x === domain));
}

let cached: AppConfig | undefined;
export function loadConfig(): AppConfig {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}

/** Test helper: reset memoised config. */
export function resetConfigCache(): void {
  cached = undefined;
}

/** Redact secrets before printing configuration (doctor, logs). */
export function redactedConfig(c: AppConfig): Record<string, string> {
  const secretKeys = /SECRET|PASSWORD|KEY|DATABASE_URL|REDIS_URL/;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) {
    if (Array.isArray(v)) continue;
    out[k] = secretKeys.test(k) ? "[redacted]" : String(v);
  }
  return out;
}
