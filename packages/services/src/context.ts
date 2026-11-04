/**
 * Service container. Every service function receives explicit dependencies, including the
 * clock, so behaviour is reproducible in tests (Section 8).
 */
import type { AppConfig } from "@buytrail/config";
import type { Db } from "@buytrail/db";
import type { Clock } from "@buytrail/domain";
import type { CatalogProvider } from "@buytrail/providers";
import type { Mailer } from "./mailer";
import type { ObjectStore } from "./storage";

export type Services = {
  db: Db;
  config: AppConfig;
  clock: Clock;
  mailer: Mailer;
  storage: ObjectStore;
  /** Provider registry keyed by source id. Only enabled, verified sources are registered. */
  providers: Map<string, CatalogProvider>;
  log: Logger;
};

export type Logger = {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
};

/** Structured JSON logger. Callers must pass internal IDs, never emails/tokens/URLs (Section 25.3). */
export function jsonLogger(component: string): Logger {
  const emit = (level: string, msg: string, meta?: Record<string, unknown>) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, component, msg, ...redact(meta) });
    if (level === "error") console.error(line);
    else console.log(line);
  };
  return { info: (m, x) => emit("info", m, x), warn: (m, x) => emit("warn", m, x), error: (m, x) => emit("error", m, x) };
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };

const SENSITIVE = /email|token|password|secret|url|postal|destination|signed/i;
function redact(meta?: Record<string, unknown>): Record<string, unknown> {
  if (!meta) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    out[k] = SENSITIVE.test(k) ? "[redacted]" : typeof v === "bigint" ? v.toString() : v instanceof Error ? v.message : v;
  }
  return out;
}
