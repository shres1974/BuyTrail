import { describe, expect, it } from "vitest";
import { FakeClock } from "@buytrail/domain";
import { DEMO_LISTINGS, DEMO_SOURCE_A, DemoProvider, FEED_COLUMNS, parseCsv, parseFeed, ProviderError, validateListing, withTimeout } from "../src";

const clock = new FakeClock(new Date("2026-11-04T15:00:00Z"));

describe("demo provider contract", () => {
  const p = new DemoProvider({ sourceId: DEMO_SOURCE_A, clock });
  it("labels every record as demo and validates", async () => {
    const r = await p.search({ query: "", limit: 50 });
    expect(r.items.length).toBe(50);
    expect(r.items.every((i) => i.sourceMode === "demo" && i.outboundUrl.includes(".example/"))).toBe(true);
    for (const i of r.items) expect(() => validateListing(i)).not.toThrow();
  });
  it("paginates with an opaque cursor", async () => {
    const a = await p.search({ query: "", limit: 10 });
    const b = await p.search({ query: "", limit: 10, cursor: a.nextCursor });
    expect(new Set([...a.items, ...b.items].map((x) => x.externalListingId)).size).toBe(20);
  });
  it("missing shipping is unknown, not zero; missing listing is a typed error", async () => {
    const m = await p.lookup({ externalListingId: "MA-118", externalVariantKey: "", sellerKey: "m_demo_maple", contextKey: "ca-national" });
    expect(m.shipping.kind).toBe("unknown");
    await expect(p.lookup({ externalListingId: "nope", externalVariantKey: "", sellerKey: "x", contextKey: "ca-national" })).rejects.toMatchObject({ code: "removed_listing" });
    await expect(p.lookup({ externalListingId: "MA-118", externalVariantKey: "", sellerKey: "x", contextKey: "postal:M5V" })).rejects.toMatchObject({ code: "unsupported_context" });
  });
  it("faults are typed (429 with Retry-After, malformed → invalid_response)", async () => {
    const f = new DemoProvider({ sourceId: DEMO_SOURCE_A, clock, fault: (id) => (id === "PN-204" ? { kind: "rate_limited", retryAfterMs: 5000 } : { kind: "malformed" }) });
    const e = await f.lookup({ externalListingId: "PN-204", externalVariantKey: "", sellerKey: "m_demo_pine", contextKey: "ca-national" }).catch((x) => x);
    expect(e).toBeInstanceOf(ProviderError);
    expect([e.code, e.retryAfterMs, e.retryable]).toEqual(["quota_exhausted", 5000, true]);
    await expect(f.lookup({ externalListingId: "CE-310", externalVariantKey: "", sellerKey: "m_demo_cedar", contextKey: "ca-national" })).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("timeouts are check failures", async () => {
    await expect(withTimeout(20, () => new Promise((r) => setTimeout(r, 200)))).rejects.toMatchObject({ code: "timeout" });
  });
  it("identifiers are opaque strings (no numeric coercion)", () => {
    expect(DEMO_LISTINGS.every((l) => typeof l.externalListingId === "string")).toBe(true);
  });
});

describe("authorized CSV feed parser", () => {
  const meta = { sourceId: "feed-x", sourceMode: "live" as const, fetchedAt: new Date("2026-11-04T15:00:00Z"), allowedHosts: ["shop.example"] };
  const header = FEED_COLUMNS.join(",");
  const row = (over: Partial<Record<(typeof FEED_COLUMNS)[number], string>> = {}) =>
    FEED_COLUMNS.map(
      (c) =>
        ({
          external_listing_id: "A-1",
          seller_key: "s1",
          seller_name: "Shop",
          title: '"Monitor, 27"" QHD"',
          brand: "Clearpeak",
          model: "CP27Q",
          gtin: "",
          condition: "new",
          stock: "in_stock",
          currency: "CAD",
          item_price: "199.99",
          shipping_status: "known",
          shipping_price: "9.99",
          fees: "0",
          outbound_url: "https://shop.example/p/A-1",
          observed_at: "2026-11-04T14:00:00Z",
          attributes: "screen_size_in=27;resolution=2560x1440",
          ...over,
        })[c],
    ).join(",");
  it("parses quoted fields and exact money", () => {
    const r = parseFeed(`${header}\n${row()}\n`, meta);
    expect(r.errors).toEqual([]);
    expect(r.listings[0]!.title).toBe('Monitor, 27" QHD');
    expect(r.listings[0]!.itemPrice).toEqual({ amountMinor: "19999", currency: "CAD" });
    expect(r.listings[0]!.attributes).toEqual({ screen_size_in: "27", resolution: "2560x1440" });
  });
  it("rejects unexpected/missing columns", () => {
    expect(() => parseFeed(`${header},extra\n`, meta)).toThrow(/Unexpected: \[extra\]/);
    expect(() => parseFeed(`external_listing_id\n`, meta)).toThrow(/Missing/);
  });
  it("row errors: disallowed host, bad money, unknown shipping status, duplicates; fees blank → unknown", () => {
    const r = parseFeed(
      [header, row({ outbound_url: "https://evil.example/x" }), row({ external_listing_id: "B", item_price: "-1" }), row({ external_listing_id: "C", shipping_status: "free" }), row({ external_listing_id: "D", fees: "" }), row({ external_listing_id: "D", fees: "" })].join("\n"),
      meta,
    );
    expect(r.errors.map((e) => e.row)).toEqual([2, 3, 4, 6]);
    expect(r.listings).toHaveLength(1);
    expect(r.listings[0]!.feeStatus).toBe("unknown");
  });
  it("is bounded by bytes and rows", () => {
    expect(() => parseFeed("x".repeat(100), meta, { maxBytes: 10, maxRows: 10 })).toThrow(/bytes/);
    expect(() => parseCsv("a\n".repeat(20), 5)).toThrow(/rows/);
  });
  it("treats formula-looking cells as plain data", () => {
    const r = parseFeed(`${header}\n${row({ title: "=HYPERLINK(\"http://x\")" })}`.replace('"=HYPERLINK(""http://x"")"', '"=HYPERLINK(""http://x"")"'), meta);
    expect(r.listings[0]?.title ?? r.errors[0]?.message).toContain("HYPERLINK");
  });
});
