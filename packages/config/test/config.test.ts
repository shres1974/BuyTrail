import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig, redactedConfig } from "../src";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  AUTH_SECRET: "local_only_aaaaaaaaaaaaaaaa",
  OBJECT_STORAGE_ACCESS_KEY: "local_only",
  OBJECT_STORAGE_SECRET_KEY: "local_only_secret",
};

describe("configuration validation (Section 29)", () => {
  it("accepts the documented local defaults in demo mode", () => {
    const c = parseConfig(base);
    expect(c.APP_MODE).toBe("demo");
    expect(c.LIVE_PROVIDERS_ENABLED).toBe(false);
    expect(c.REAL_RECEIPT_UPLOADS_ENABLED).toBe(false);
  });
  it("live mode rejects local-only secrets, http base URLs and local email", () => {
    try {
      parseConfig({ ...base, APP_MODE: "live", APP_BASE_URL: "http://example.test" });
      expect.unreachable();
    } catch (e) {
      const p = (e as ConfigError).problems.join("\n");
      expect(p).toMatch(/AUTH_SECRET contains a local-only value/);
      expect(p).toMatch(/OBJECT_STORAGE_SECRET_KEY contains a local-only value/);
      expect(p).toMatch(/https/);
      expect(p).toMatch(/EMAIL_MODE=local/);
    }
  });
  it("G30: demo mode cannot enable real receipt uploads or live providers", () => {
    expect(() => parseConfig({ ...base, REAL_RECEIPT_UPLOADS_ENABLED: "true" })).toThrow(/G30/);
    expect(() => parseConfig({ ...base, LIVE_PROVIDERS_ENABLED: "true" })).toThrow(/demo mode/);
  });
  it("live mode with uploads requires a scanner", () => {
    expect(() =>
      parseConfig({
        DATABASE_URL: "postgresql://u:p@db.internal:5432/db",
        AUTH_SECRET: "x".repeat(40),
        OBJECT_STORAGE_ACCESS_KEY: "AKIA_EXAMPLE",
        OBJECT_STORAGE_SECRET_KEY: "s".repeat(40),
        APP_MODE: "live",
        APP_BASE_URL: "https://buytrail.example",
        EMAIL_MODE: "smtp",
        REAL_RECEIPT_UPLOADS_ENABLED: "true",
        RECEIPT_SCANNER: "none",
      }),
    ).toThrow(/scanner/i);
  });
  it("AI features cannot be enabled (no provider implemented)", () => {
    expect(() => parseConfig({ ...base, AI_FEATURES_ENABLED: "true" })).toThrow(/AI_FEATURES_ENABLED/);
  });
  it("limits have ceilings", () => {
    expect(() => parseConfig({ ...base, MAX_ACTIVE_WATCHES_PER_USER: "100000" })).toThrow(ConfigError);
  });
  it("redaction never prints secrets", () => {
    const r = redactedConfig(parseConfig(base));
    expect(JSON.stringify(r)).not.toContain("local_only_secret");
    expect(r.DATABASE_URL).toBe("[redacted]");
    expect(r.AUTH_SECRET).toBe("[redacted]");
  });
});
