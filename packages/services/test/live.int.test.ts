/**
 * Live SerpApi source against real PostgreSQL with a stubbed HTTP layer (no credits): sweeps
 * ingest through the normal pipeline, rank alongside the data policy, drive watches, keep stable
 * per-seller history, and are hard-capped by daily and rolling budgets.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_VARIANT_BY_ID, LIVE_VARIANTS, SERPAPI_SOURCE_ID, SerpApiShoppingProvider } from "@buytrail/providers";
import { createWatch, liveSearchesUsed, searchCatalog, PUBLIC_CONTEXT_ID, seedLiveCatalog, sweepDueLiveVariants, sweepLiveVariant, syncRefreshSchedules, variantHistory, variantOffers } from "../src";
import { FIXTURE } from "../../providers/test/serpapi-fixture";
import { drainOutbox, makeUser, seeded, type Kit } from "./kit";

let k: Kit;
let calls = 0;
let body: unknown = FIXTURE;
const V = "var_live_sony_wh1000xm5_black";
const tracked = LIVE_VARIANT_BY_ID.get(V)!;

const stubFetch = (async () => {
  calls++;
  return new Response(JSON.stringify(body), { status: 200 });
}) as unknown as typeof fetch;

const provider = () => new SerpApiShoppingProvider({ apiKey: "k_test", clock: k.clock, fetchImpl: stubFetch });

beforeAll(async () => {
  k = await seeded({ LIVE_PROVIDERS_ENABLED: "true", SERPAPI_API_KEY: "k_test", SERPAPI_DAILY_BUDGET: "6", SERPAPI_MONTHLY_BUDGET: "10" });
  await seedLiveCatalog(k.db, k.config, k.clock.now());
}, 120_000);

describe("live catalog seeding", () => {
  it("creates the approved live source, 15 real products and due sweeps; reruns are idempotent", async () => {
    await seedLiveCatalog(k.db, k.config, k.clock.now());
    const s = await k.db.source.findUniqueOrThrow({ where: { id: SERPAPI_SOURCE_ID } });
    expect([s.mode, s.approvalStatus, s.dailyRequestBudget]).toEqual(["live", "approved", 6]);
    expect(await k.db.product.count({ where: { isDemo: false } })).toBe(LIVE_VARIANTS.length);
    expect(await k.db.liveSweep.count()).toBe(LIVE_VARIANTS.length);
  });
  it("removes a product dropped from the curated list when nothing references it", async () => {
    await k.db.product.create({ data: { id: "prod_live_old", title: "Old", brand: "X", category: "monitors", family: "Old", isDemo: false } });
    await k.db.productVariant.create({ data: { id: "var_live_old", productId: "prod_live_old", modelCode: "OLD1", modelCodeNormalized: "OLD1", label: "Old", attributes: {}, isDemo: false } });
    await k.db.liveSweep.create({ data: { variantId: "var_live_old", sourceId: SERPAPI_SOURCE_ID, nextDueAt: k.clock.now() } });
    await seedLiveCatalog(k.db, k.config, k.clock.now());
    expect(await k.db.product.findUnique({ where: { id: "prod_live_old" } })).toBeNull();
    expect(await k.db.liveSweep.count()).toBe(LIVE_VARIANTS.length);
  });
});

describe("sweep → comparison", () => {
  it("ranks live offers by known total; unknown shipping is not ranked", async () => {
    const r = await sweepLiveVariant(k.db, k.clock, k.config, provider(), tracked);
    expect(r).toMatchObject({ kind: "swept", listings: 7 });
    const o = await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now());
    expect(o.isDemo).toBe(false);
    expect(o.ranked.map((x) => [x.merchant.name, x.knownTotal!.display])).toEqual([
      ["Costco", "CAD 349.99"], // free delivery threshold $75 applies
      ["Amazon.ca", "CAD 357.99"], // 348.00 + 9.99 delivery
      ["Best Buy", "CAD 389.99"],
      ["Staples", "CAD 401.99"], // 389.99 + 12.00 delivery
    ]);
    expect(o.ranked.every((x) => !x.isDemo && x.stock === "in_stock")).toBe(true);
    expect(o.incompleteTotal.map((x) => x.merchant.name)).toEqual(["Walmart.ca"]);
    expect(o.other.some((x) => x.merchant.name === "B&H" && x.reasons.includes("wrong_currency"))).toBe(true);
    const refurb = await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "refurbished", k.clock.now());
    expect(refurb.ranked.map((x) => x.merchant.name)).toEqual(["audio_outlet"]);
  });

  it("live listings are not scheduled for per-listing lookups (no hidden credit use)", async () => {
    await syncRefreshSchedules(k.db, k.clock.now(), { watchedSeconds: 900, idleSeconds: 3600 });
    const liveIds = (await k.db.sourceListing.findMany({ where: { sourceId: SERPAPI_SOURCE_ID }, select: { id: true } })).map((l) => l.id);
    expect(await k.db.refreshSchedule.count({ where: { listingId: { in: liveIds } } })).toBe(0);
  });
});

describe("search ordering", () => {
  it("lists live products before sample products, but an exact sample model match still comes first", async () => {
    const isDemo = async (q: string, sort?: "lowest_total") => (await searchCatalog(k.db, { q, limit: 100, ...(sort ? { sort } : {}) }, k.clock.now(), "s")).items.map((i) => i.isDemo);
    for (const flags of [await isDemo(""), await isDemo("monitor"), await isDemo("", "lowest_total")]) {
      expect(flags.includes(false) && flags.includes(true)).toBe(true);
      expect(flags.indexOf(true)).toBeGreaterThan(flags.lastIndexOf(false));
    }
    const exact = await searchCatalog(k.db, { q: "CP27Q" }, k.clock.now(), "s");
    expect(exact.items[0]!.isDemo).toBe(true);
  });
});

describe("sweep → watch → alert", () => {
  it("a price drop on the next sweep fires a watch; history keeps one series per seller", async () => {
    const u = await makeUser(k.db);
    await createWatch(k.db, k.config, k.clock.now(), u, { variantId: V, target: { amountMinor: "33000", currency: "CAD" }, channels: ["in_app"] }, null);
    k.clock.advance(73 * 3600_000);
    const res = JSON.parse(JSON.stringify(FIXTURE)) as { shopping_results: Array<Record<string, unknown>> };
    res.shopping_results[1] = { ...res.shopping_results[1], price: "$318.00", extracted_price: 318 }; // Amazon 318 + 9.99
    body = res;
    expect((await sweepDueLiveVariants(k.db, k.clock, k.config, provider(), { max: 1 }))[0]).toMatchObject({ variantId: expect.any(String), kind: "swept" });
    await sweepLiveVariant(k.db, k.clock, k.config, provider(), tracked);
    await drainOutbox(k);
    const ev = await k.db.notificationEvent.findMany({ where: { userId: u.id, type: "price_target_met" } });
    expect(ev).toHaveLength(1);
    expect(ev[0]!.isDemo).toBe(false);
    const amazon = await k.db.sourceListing.findMany({ where: { sourceId: SERPAPI_SOURCE_ID, sellerKey: "amazon-ca", variantId: V } });
    expect(amazon).toHaveLength(1);
    expect(await k.db.priceObservation.count({ where: { listingId: amazon[0]!.id } })).toBe(2);
    const h = await variantHistory(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now());
    expect(h.isDemo).toBe(false);
  });

  it("a seller missing from the next search is withdrawn; an empty search changes nothing", async () => {
    const res = JSON.parse(JSON.stringify(FIXTURE)) as { shopping_results: Array<Record<string, unknown>> };
    res.shopping_results = res.shopping_results.filter((x) => x.source !== "Staples");
    body = res;
    k.clock.advance(73 * 3600_000);
    await sweepLiveVariant(k.db, k.clock, { ...k.config, SERPAPI_MONTHLY_BUDGET: 1000 }, provider(), tracked, { ignoreDailyCap: true });
    const o = await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now());
    expect(o.ranked.map((x) => x.merchant.name)).not.toContain("Staples");
    body = { search_metadata: { status: "Success" }, shopping_results: [] };
    await sweepLiveVariant(k.db, k.clock, { ...k.config, SERPAPI_MONTHLY_BUDGET: 1000 }, provider(), tracked, { ignoreDailyCap: true });
    const o2 = await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now());
    expect(o2.ranked.length).toBe(o.ranked.length);
    body = FIXTURE;
    await sweepLiveVariant(k.db, k.clock, { ...k.config, SERPAPI_MONTHLY_BUDGET: 1000 }, provider(), tracked, { ignoreDailyCap: true });
    expect((await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now())).ranked.map((x) => x.merchant.name)).toContain("Staples");
  });
});

describe("budgets", () => {
  it("daily cap blocks further searches without calling SerpApi; rolling cap blocks bootstrap too", async () => {
    body = FIXTURE;
    const before = calls;
    const r = await sweepDueLiveVariants(k.db, k.clock, k.config, provider(), { max: 20, all: true });
    const used = await liveSearchesUsed(k.db, k.clock.now());
    expect(r.at(-1)).toMatchObject({ kind: "skipped" });
    expect(calls - before).toBe(r.filter((x) => x.kind !== "skipped").length);
    expect(used).toBeLessThanOrEqual(10);
    // Bootstrap may exceed the daily cap but never the rolling 30-day cap.
    const b = await sweepDueLiveVariants(k.db, k.clock, k.config, provider(), { max: 20, all: true, ignoreDailyCap: true });
    expect(await liveSearchesUsed(k.db, k.clock.now())).toBe(10);
    expect(b.at(-1)).toMatchObject({ kind: "skipped", reason: "monthly_budget_exhausted" });
  });
  it("a provider failure is recorded and postpones that variant without touching prices", async () => {
    const tight = { ...k.config, SERPAPI_MONTHLY_BUDGET: 1000 };
    const failing = new SerpApiShoppingProvider({ apiKey: "k", clock: k.clock, fetchImpl: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch });
    const before = await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now());
    const r = await sweepLiveVariant(k.db, k.clock, tight, failing, tracked, { ignoreDailyCap: true });
    expect(r).toEqual({ variantId: V, kind: "failed", code: "temporarily_unavailable" });
    const s = await k.db.liveSweep.findUniqueOrThrow({ where: { variantId: V } });
    expect(s.lastErrorCode).toBe("temporarily_unavailable");
    expect(s.nextDueAt.getTime()).toBeGreaterThan(k.clock.now().getTime());
    const after = await variantOffers(k.db, V, PUBLIC_CONTEXT_ID, "new", k.clock.now());
    expect(after.ranked.map((x) => x.knownTotal!.display)).toEqual(before.ranked.map((x) => x.knownTotal!.display));
  });
});
