import { describe, expect, it } from "vitest";
import {
  backoffMs,
  checkPriceAnomaly,
  csvSafeCell,
  decodeCursor,
  effectiveExpiry,
  encodeCursor,
  historyCoverageLabel,
  isAllowedOutboundUrl,
  localToday,
  money,
  parseProductLink,
  planReminders,
} from "../src";

describe("date fixtures (Section 28.2, R15)", () => {
  const now = new Date("2026-10-01T00:00:00Z");
  it("date-only deadline: 09:00 local, 3 and 1 days before", () => {
    const r = planReminders({ date: "2026-11-20", cutoffTime: null, timezone: "America/Toronto" }, now);
    expect(r.map((x) => x.localLabel)).toEqual(["2026-11-17 09:00 EST", "2026-11-19 09:00 EST"]);
    expect(r.map((x) => x.dueAt.toISOString())).toEqual(["2026-11-17T14:00:00.000Z", "2026-11-19T14:00:00.000Z"]);
  });
  it("crosses the November DST fall-back: offsets use local calendar days", () => {
    // DST ends 2026-11-01 02:00 in Toronto.
    const r = planReminders({ date: "2026-11-03", cutoffTime: null, timezone: "America/Toronto" }, now);
    expect(r[0]!.localLabel).toBe("2026-10-31 09:00 EDT");
    expect(r[0]!.dueAt.toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(r[1]!.localLabel).toBe("2026-11-02 09:00 EST");
    expect(r[1]!.dueAt.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
  it("nonexistent spring-forward local time moves to the next valid instant", () => {
    // 2027-03-14 02:30 does not exist in Toronto; cutoff deadline on 2027-03-15 with -1 day offset.
    const r = planReminders({ date: "2027-03-15", cutoffTime: "02:30", timezone: "America/Toronto" }, now, [1]);
    expect(r[0]!.dueAt.toISOString()).toBe("2027-03-14T07:30:00.000Z"); // 03:30 EDT
    expect(r[0]!.localLabel).toBe("2027-03-14 03:30 EDT");
  });
  it("ambiguous fall-back local time uses the earlier occurrence", () => {
    const r = planReminders({ date: "2026-11-02", cutoffTime: "01:30", timezone: "America/Toronto" }, now, [1]);
    expect(r[0]!.dueAt.toISOString()).toBe("2026-11-01T05:30:00.000Z"); // 01:30 EDT, the first
  });
  it("past offsets are skipped, not burst-sent", () => {
    const late = new Date("2026-11-18T12:00:00Z");
    const r = planReminders({ date: "2026-11-20", cutoffTime: null, timezone: "America/Toronto" }, late);
    expect(r.map((x) => x.status)).toEqual(["skipped_past", "scheduled"]);
  });
  it("other zones are honoured", () => {
    // America/Regina observes no DST (UTC-6 year-round).
    const r = planReminders({ date: "2026-11-20", cutoffTime: null, timezone: "America/Regina" }, now, [1]);
    expect(r[0]!.dueAt.toISOString()).toBe("2026-11-19T15:00:00.000Z");
    // Vancouver offset comes from the runtime's tzdata (2026e has BC on permanent UTC-7);
    // assert the local wall time rather than hard-coding an offset that legislation may change.
    const v = planReminders({ date: "2026-11-20", cutoffTime: null, timezone: "America/Vancouver" }, now, [1]);
    expect(v[0]!.localLabel.startsWith("2026-11-19 09:00")).toBe(true);
  });
  it("rejects invalid dates and zones", () => {
    expect(() => planReminders({ date: "2026-02-30", cutoffTime: null, timezone: "America/Toronto" }, now)).toThrow();
    expect(() => planReminders({ date: "2026-11-20", cutoffTime: null, timezone: "Mars/Base" }, now)).toThrow();
  });
  it("local calendar date does not shift for date-only purchases", () => {
    expect(localToday(new Date("2026-11-05T03:00:00Z"), "America/Toronto")).toBe("2026-11-04");
  });
});

describe("freshness and anomalies (R08, R19)", () => {
  const fetchedAt = new Date("2026-11-04T12:00:00Z");
  it("uses the strictest bound and the source-observed time", () => {
    const e = effectiveExpiry({ fetchedAt, sourceObservedAt: new Date("2026-11-04T08:00:00Z"), validUntil: null, policy: { maxAgeSeconds: 6 * 3600 } });
    expect(e.toISOString()).toBe("2026-11-04T14:00:00.000Z");
    const v = effectiveExpiry({ fetchedAt, sourceObservedAt: null, validUntil: new Date("2026-11-04T13:00:00Z"), policy: { maxAgeSeconds: 6 * 3600 } });
    expect(v.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    const r = effectiveExpiry({ fetchedAt, sourceObservedAt: null, validUntil: null, policy: { maxAgeSeconds: 6 * 3600, retentionSeconds: 1800 } });
    expect(r.toISOString()).toBe("2026-11-04T12:30:00.000Z");
  });
  it("G16 heuristic: a 90% drop is suspicious", () => {
    expect(checkPriceAnomaly(money(20000n), money(2000n)).suspicious).toBe(true);
    expect(checkPriceAnomaly(money(20000n), money(18000n)).suspicious).toBe(false);
  });
  it("G25: history coverage never overclaims", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    expect(historyCoverageLabel(new Date("2026-10-27T12:00:00Z"), 30, now, fmt)).toBe("Lowest observed since 2026-10-27");
    expect(historyCoverageLabel(new Date("2026-09-01T12:00:00Z"), 30, now, fmt)).toBe("Lowest observed in the last 30 days");
    expect(historyCoverageLabel(null, 30, now, fmt)).toBeNull();
  });
});

describe("links, cursors, retries, CSV", () => {
  const rules = [{ sourceId: "demo", hosts: ["shop.example.test"], pathPattern: /^\/p\/([A-Za-z0-9_-]{1,64})$/ }];
  it("parses only supported https hosts and paths", () => {
    expect(parseProductLink("https://shop.example.test/p/PN-204", rules)).toEqual({ ok: true, sourceId: "demo", externalListingId: "PN-204" });
    expect(parseProductLink("http://shop.example.test/p/PN-204", rules)).toMatchObject({ ok: false, reason: "unsupported_scheme" });
    expect(parseProductLink("https://169.254.169.254/p/x", rules)).toMatchObject({ ok: false, reason: "unsupported_host" });
    expect(parseProductLink("https://shop.example.test.evil.com/p/x", rules)).toMatchObject({ ok: false, reason: "unsupported_host" });
    expect(parseProductLink("https://user:pw@shop.example.test/p/x", rules)).toMatchObject({ ok: false, reason: "credentials_in_url" });
    expect(parseProductLink("https://shop.example.test:8443/p/x", rules)).toMatchObject({ ok: false, reason: "nonstandard_port" });
    expect(parseProductLink("file:///etc/passwd", rules)).toMatchObject({ ok: false, reason: "unsupported_scheme" });
    expect(parseProductLink("javascript:alert(1)", rules)).toMatchObject({ ok: false });
    expect(isAllowedOutboundUrl("https://shop.example.test/p/1", ["shop.example.test"])).toBe(true);
    expect(isAllowedOutboundUrl("javascript:alert(1)", ["shop.example.test"])).toBe(false);
  });
  it("cursor is bound to query signature and tamper-evident", () => {
    const c = encodeCursor({ sig: "q=monitor", key: [1, "p_1"] }, "secret");
    expect(decodeCursor(c, "q=monitor", "secret")).toEqual([1, "p_1"]);
    expect(decodeCursor(c, "q=kettle", "secret")).toBeNull();
    expect(decodeCursor(c.slice(0, -2) + "xx", "q=monitor", "secret")).toBeNull();
  });
  it("backoff grows, is jittered, and honours Retry-After", () => {
    expect(backoffMs(1, { random: () => 0 })).toBe(500);
    expect(backoffMs(4, { random: () => 1 })).toBe(8000);
    expect(backoffMs(1, { random: () => 0, retryAfterMs: 30_000 })).toBe(30_000);
  });
  it("neutralizes spreadsheet formulas", () => {
    expect(csvSafeCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvSafeCell("Hello, world")).toBe('"Hello, world"');
  });
});
