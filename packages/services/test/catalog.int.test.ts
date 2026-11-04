/**
 * M1/M2 integration: seeded catalog through the real ingestion pipeline, comparison golden
 * fixtures against PostgreSQL, matching outcomes, search relevance, history coverage.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { DEMO_CONTEXT_ID, DEMO_LISTINGS, DEMO_VARIANTS } from "@buytrail/providers";
import { productDetail, refreshAllDemo, searchCatalog, seedDemoCatalog, seedDemoListings, variantHistory, variantOffers } from "../src";
import { seeded, type Kit } from "./kit";

let k: Kit;
const SECRET = "cursor_secret_for_tests";

beforeAll(async () => {
  k = await seeded();
  await seedDemoListings(k.db, k.clock, { historyDays: 10 });
}, 120_000);

const listingStatus = async (ext: string) => (await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: ext } })).matchStatus;

describe("catalog fixtures", () => {
  it("meets demo fixture size (≥30 variants, ≥90 listings)", async () => {
    expect(DEMO_VARIANTS.length).toBeGreaterThanOrEqual(30);
    expect(DEMO_LISTINGS.length).toBeGreaterThanOrEqual(90);
    expect(await k.db.productVariant.count()).toBe(DEMO_VARIANTS.length);
    expect(await k.db.sourceListing.count()).toBe(DEMO_LISTINGS.length);
  });

  it("seeding is rerunnable without duplicating records", async () => {
    await seedDemoCatalog(k.db);
    const before = await k.db.priceObservation.count();
    await seedDemoListings(k.db, k.clock, { historyDays: 0 });
    expect(await k.db.productVariant.count()).toBe(DEMO_VARIANTS.length);
    expect(await k.db.sourceListing.count()).toBe(DEMO_LISTINGS.length);
    // A new seed run is a new check (new run ID) — one more observation per listing at most.
    expect(await k.db.priceObservation.count()).toBeLessThanOrEqual(before + DEMO_LISTINGS.length);
  });
});

describe("golden comparison against the database", () => {
  it("G01: Store Cedar CAD 205.00 ranks first; CAD 4.98 less than Store Pine", async () => {
    const r = await variantOffers(k.db, "var_demo_monitor_27_qhd", DEMO_CONTEXT_ID, "new", k.clock.now());
    const cedar = r.ranked.find((o) => o.merchant.name === "Store Cedar")!;
    const pine = r.ranked.find((o) => o.merchant.name === "Store Pine")!;
    expect(cedar.knownTotal!.display).toBe("CAD 205.00");
    expect(pine.knownTotal!.display).toBe("CAD 209.98");
    expect(cedar.rank).toBeLessThan(pine.rank!);
    expect(r.ranked[0]!.merchant.name).toBe("Store Cedar");
    expect(r.explanation).toContain("CAD 4.98 less than Store Pine");
  });
  it("G02: unknown shipping is in the incomplete group with its item price, never ranked", async () => {
    const r = await variantOffers(k.db, "var_demo_monitor_27_qhd", DEMO_CONTEXT_ID, "new", k.clock.now());
    const maple = r.incompleteTotal.find((o) => o.merchant.name === "Store Maple")!;
    expect(maple.itemPrice!.display).toBe("CAD 189.99");
    expect(maple.knownTotal).toBeNull();
    expect(r.ranked.some((o) => o.merchant.name === "Store Maple")).toBe(false);
  });
  it("G03: USD offer excluded from ranking", async () => {
    const r = await variantOffers(k.db, "var_demo_monitor_27_qhd", DEMO_CONTEXT_ID, "new", k.clock.now());
    expect(r.ranked.every((o) => o.knownTotal!.currency === "CAD")).toBe(true);
    expect(r.other.some((o) => o.reasons.includes("wrong_currency"))).toBe(true);
  });
  it("G04: CP27QX listing is a review candidate, not merged into CP27Q", async () => {
    expect(await listingStatus("BI-777")).toBe("candidate");
    const l = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: "BI-777" } });
    expect(l.variantId).toBeNull();
    const pn205 = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: "PN-205" } });
    expect(pn205.variantId).toBe("var_demo_monitor_27_qhd_144");
  });
  it("G05: GTIN of 1.7 L kettle with 1.0 L capacity is quarantined", async () => {
    expect(await listingStatus("BI-512")).toBe("quarantined");
    const d = await k.db.matchDecision.findFirstOrThrow({ where: { listing: { externalListingId: "BI-512" } }, orderBy: { createdAt: "desc" } });
    expect(d.reason).toBe("identifier_attribute_conflict");
  });
  it("G06: refurbished offer is a separate condition group", async () => {
    const n = await variantOffers(k.db, "var_demo_quiet2_black", DEMO_CONTEXT_ID, "new", k.clock.now());
    const rf = await variantOffers(k.db, "var_demo_quiet2_black", DEMO_CONTEXT_ID, "refurbished", k.clock.now());
    expect(n.ranked.every((o) => o.condition === "new")).toBe(true);
    expect(rf.ranked.map((o) => o.merchant.name)).toEqual(["Store Birch"]);
    expect(n.conditionsAvailable).toEqual(["new", "refurbished"]);
  });
  it("G07: invalid identifier without model → quarantined", async () => {
    expect(await listingStatus("MA-404")).toBe("quarantined");
  });
  it("G08: members-only price excluded from ranking", async () => {
    const r = await variantOffers(k.db, "var_demo_pulse_black", DEMO_CONTEXT_ID, "new", k.clock.now());
    expect(r.ranked.some((o) => o.merchant.name === "Store Birch")).toBe(false);
    expect(r.other.find((o) => o.merchant.name === "Store Birch")!.reasons).toContain("restricted_price");
  });
  it("G09: threshold shipping does not make a CAD 205 item free", async () => {
    const r = await variantOffers(k.db, "var_demo_vantro_v27", DEMO_CONTEXT_ID, "new", k.clock.now());
    const sp = r.incompleteTotal.find((o) => o.merchant.name === "Store Spruce")!;
    expect(sp.knownTotal).toBeNull();
    expect(sp.shippingText).toMatch(/only at or above CAD 250.00/);
  });
  it("stale source observation is shown as stale and not ranked", async () => {
    const r = await variantOffers(k.db, "var_demo_monitor_24_fhd", DEMO_CONTEXT_ID, "new", k.clock.now());
    expect(r.stale.map((o) => o.merchant.name)).toContain("Store Maple");
    expect(r.ranked.some((o) => o.merchant.name === "Store Maple")).toBe(false);
  });
  it("GTIN-12 and zero-padded GTIN-13 both match the same variant (leading zeros preserved)", async () => {
    for (const ext of ["PN-601", "CE-601"]) {
      const l = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: ext } });
      expect(l.variantId).toBe("var_demo_studio1_wired");
    }
  });
  it("there are zero automatic matches to the wrong variant in the demo catalog", async () => {
    const wrong: string[] = [];
    for (const l of DEMO_LISTINGS) {
      const row = await k.db.sourceListing.findFirstOrThrow({ where: { externalListingId: l.externalListingId } });
      if (row.matchStatus === "verified" && row.variantId !== l.describes) wrong.push(l.externalListingId);
      if (l.describes === null && row.matchStatus === "verified") wrong.push(`${l.externalListingId}(should not verify)`);
    }
    expect(wrong).toEqual([]);
  });
});

describe("search (Section 14)", () => {
  const search = (q: string, extra: Record<string, unknown> = {}) => searchCatalog(k.db, { q, ...extra }, k.clock.now(), SECRET);
  it("exact model code ranks its product first", async () => {
    expect((await search("CP27Q-H")).items[0]!.productId).toBe("prod_demo_clearpeak_cp27q");
    expect((await search("hw-k10")).items[0]!.productId).toBe("prod_demo_hearthwell_kettle");
  });
  it("brand + family words", async () => {
    expect((await search("northline quiet")).items[0]!.productId).toBe("prod_demo_northline_quiet2");
  });
  it("typo tolerance via trigram", async () => {
    const ids = (await search("hearthwel kettel")).items.map((i) => i.productId);
    expect(ids).toContain("prod_demo_hearthwell_kettle");
  });
  it("category phrase", async () => {
    const r = await search("monitor");
    expect(r.items.length).toBeGreaterThanOrEqual(6);
    expect(r.items.every((i) => i.category === "monitors")).toBe(true);
  });
  it("GTIN lookup with and without leading zero", async () => {
    const v = DEMO_VARIANTS.find((x) => x.id === "var_demo_studio1_wired")!;
    expect((await search(v.gtin)).items[0]!.productId).toBe("prod_demo_fernway_studio");
    expect((await search(`00${v.gtin}`)).items[0]!.productId).toBe("prod_demo_fernway_studio");
  });
  it("absent product returns empty with coverage info", async () => {
    const r = await search("espresso machine");
    expect(r.items).toEqual([]);
    expect(r.coverage.categories.map((c) => c.key)).toEqual(["headphones", "monitors", "small_appliances"]);
  });
  it("multi-variant cards say choose a variant; single-variant cards carry the variant id", async () => {
    const r = await search("quiet 2");
    const q2 = r.items.find((i) => i.productId === "prod_demo_northline_quiet2")!;
    expect(q2.needsVariantChoice).toBe(true);
    expect(q2.priceLabel).toMatch(/choose a variant/);
    const r2 = await search("CP24F");
    expect(r2.items[0]!.variantId).toBe("var_demo_monitor_24_fhd");
  });
  it("category filters narrow variants; unsupported filters are rejected", async () => {
    const r = await search("", { category: "monitors", filters: { screen_size_in: "27" } });
    expect(r.items.map((i) => i.productId).sort()).toEqual(["prod_demo_clearpeak_cp27q", "prod_demo_vantro_v27"]);
    await expect(search("", { category: "monitors", filters: { voltage: "120 V" } })).rejects.toThrow(/Unsupported filter/);
  });
  it("pagination is stable, cursors are bound to the query", async () => {
    const p1 = await search("", { limit: 5 });
    expect(p1.items).toHaveLength(5);
    const p2 = await search("", { limit: 5, cursor: p1.nextCursor! });
    expect(new Set([...p1.items, ...p2.items].map((i) => i.productId)).size).toBe(10);
    await expect(search("monitor", { limit: 5, cursor: p1.nextCursor! })).rejects.toThrow(/cursor/);
  });
  it("lowest_total sort orders by eligible total within relevant results", async () => {
    const r = await search("monitor", { sort: "lowest_total" });
    const totals = r.items.filter((i) => i.bestKnownTotal).map((i) => BigInt(i.bestKnownTotal!.amountMinor));
    expect([...totals].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))).toEqual(totals);
  });
  it("an expired offer cannot remain best at render time", async () => {
    const later = new Date(k.clock.now().getTime() + 7 * 3600_000);
    const r = await searchCatalog(k.db, { q: "CP27Q" }, later, SECRET);
    expect(r.items[0]!.bestKnownTotal).toBeNull();
    expect(r.items[0]!.priceLabel).toBe("No confirmed total right now");
  });
});

describe("history (Section 15, G25)", () => {
  it("reports actual coverage, never a longer window", async () => {
    const h = await variantHistory(k.db, "var_demo_monitor_27_qhd", DEMO_CONTEXT_ID, "new", k.clock.now());
    expect(h.available).toBe(true);
    if (!h.available) return;
    expect(h.lowestLabel).toMatch(/^Lowest observed since /);
    expect(h.lowestLabel).not.toMatch(/30 days/);
    expect(h.points.length).toBeGreaterThanOrEqual(10);
    expect(h.series).toMatch(/before tax/);
  });
  it("G29: source without history permission → history disabled", async () => {
    await k.db.source.update({ where: { id: "demo-retail-feed" }, data: { historyRetentionDays: null } });
    await k.db.source.update({ where: { id: "demo-marketplace-feed" }, data: { historyRetentionDays: null } });
    const h = await variantHistory(k.db, "var_demo_monitor_27_qhd", DEMO_CONTEXT_ID, "new", k.clock.now());
    expect(h.available).toBe(false);
    const before = await k.db.priceObservation.count();
    await refreshAllDemo(k.db, k.clock);
    expect(await k.db.priceObservation.count()).toBe(before); // no new retained observations
    await k.db.source.updateMany({ data: { historyRetentionDays: 180 } });
  });
});

describe("product detail", () => {
  it("lists exact variants with distinguishing attributes", async () => {
    const p = await productDetail(k.db, "prod_demo_hearthwell_kettle");
    expect(p.variants.map((v) => v.id)).toContain("var_demo_kettle_17_2pk");
    expect(p.attributeDefs.find((a) => a.key === "capacity")!.critical).toBe(true);
  });
});
