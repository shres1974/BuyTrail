/**
 * SerpApi Google Shopping connector: parsing, data policy and title-rule attribution against a
 * hand-written fixture shaped like the documented response (no live data, no credits).
 */
import { describe, expect, it } from "vitest";
import { FakeClock } from "@buytrail/domain";
import {
  attributeOffers,
  LIVE_VARIANT_BY_ID,
  LIVE_VARIANTS,
  parseCondition,
  parseDelivery,
  parseSeller,
  parseShoppingResponse,
  priceCurrency,
  ProviderError,
  SerpApiShoppingProvider,
  titleMatches,
  toMinor,
  validateListing,
} from "../src";
import { FIXTURE } from "./serpapi-fixture";

const clock = new FakeClock(new Date("2026-11-05T15:00:00Z"));
const xm5 = LIVE_VARIANT_BY_ID.get("var_live_sony_wh1000xm5_black")!;

describe("SerpApi response parsing", () => {
  it("parses money exactly, rejecting junk", () => {
    expect(toMinor(399.99, null)).toBe(39999n);
    expect(toMinor(null, "$1,299.5")).toBe(129950n);
    expect(toMinor(0, "$0.00")).toBeNull();
    expect(toMinor(-5, null)).toBeNull();
    expect(toMinor(Number.NaN, "free")).toBeNull();
    expect(toMinor(5_000_000, null)).toBeNull();
  });
  it("detects currency; unknown symbols are rejected", () => {
    expect(priceCurrency("$12.00")).toBe("CAD");
    expect(priceCurrency("CA$12.00")).toBe("CAD");
    expect(priceCurrency("US$12.00")).toBe("USD");
    expect(priceCurrency("€12,00")).toBeNull();
  });
  it("delivery text: explicit free/paid is known, thresholds are thresholds, otherwise unknown", () => {
    expect(parseDelivery(["Free delivery"], "CAD")).toMatchObject({ kind: "known", amount: { amountMinor: "0" } });
    expect(parseDelivery(["Get it by Wed (Free)"], "CAD")).toMatchObject({ kind: "known", amount: { amountMinor: "0" } });
    expect(parseDelivery(["$9.99 delivery"], "CAD")).toMatchObject({ kind: "known", amount: { amountMinor: "999" } });
    expect(parseDelivery(["Delivery: $5"], "CAD")).toMatchObject({ kind: "known", amount: { amountMinor: "500" } });
    expect(parseDelivery(["Get it today ($10)"], "CAD")).toMatchObject({ kind: "known", amount: { amountMinor: "1000" } });
    expect(parseDelivery(["Free delivery on orders over $35"], "CAD")).toMatchObject({ kind: "threshold", freeAtOrAbove: { amountMinor: "3500" }, belowAmount: null });
    expect(parseDelivery(["Free shipping $50+"], "CAD")).toMatchObject({ kind: "threshold", freeAtOrAbove: { amountMinor: "5000" } });
    expect(parseDelivery([], "CAD").kind).toBe("unknown");
    expect(parseDelivery(["Delivery by Friday"], "CAD").kind).toBe("unknown");
    expect(parseDelivery(["Free returns"], "CAD").kind).toBe("unknown");
    expect(parseDelivery(["Free pickup today"], "CAD").kind).toBe("unknown");
  });
  it("condition and seller parsing", () => {
    expect(parseCondition("Sony XM5 - Renewed", [])).toBe("refurbished");
    expect(parseCondition("Sony XM5", ["Pre-owned"])).toBe("used");
    expect(parseCondition("Sony XM5 open box", [])).toBe("used");
    expect(parseCondition("Sony XM5", ["51% OFF"])).toBe("new");
    expect(parseSeller("eBay - audio_outlet")).toEqual({ sellerName: "audio_outlet", platform: "eBay", sellerSlug: "ebay-audio-outlet" });
    expect(parseSeller("Best Buy")).toEqual({ sellerName: "Best Buy", platform: null, sellerSlug: "best-buy" });
  });
  it("skips results without seller, non-CAD/USD price, or instalment pricing", () => {
    const p = parseShoppingResponse(FIXTURE, xm5.query);
    expect(p.total).toBe(13);
    expect(p.skipped).toBe(2); // no source, "/mo"
    expect(p.offers.find((o) => o.sellerName === "B&H")?.currency).toBe("USD");
    expect(p.offers.every((o) => o.outboundUrl.startsWith("https://"))).toBe(true);
    expect(p.offers[0]!.outboundUrl).not.toContain("&amp;");
  });
  it("empty or missing result arrays parse to zero offers", () => {
    expect(parseShoppingResponse({}, "x")).toEqual({ offers: [], skipped: 0, total: 0 });
    expect(parseShoppingResponse(null, "x").offers).toEqual([]);
  });
});

describe("title rules", () => {
  it("accept the exact model, reject other colours, generations and accessories", () => {
    expect(titleMatches("Sony WH-1000XM5 Wireless Headphones - Black", xm5.rules)).toBe(true);
    expect(titleMatches("SONY WH1000XM5/B headphones", xm5.rules)).toBe(true);
    expect(titleMatches("Sony WH-1000XM5 Headphones Silver", xm5.rules)).toBe(false);
    expect(titleMatches("Sony WH-1000XM4 Headphones Black", xm5.rules)).toBe(false);
    expect(titleMatches("Replacement Ear Pads for Sony WH-1000XM5", xm5.rules)).toBe(false);
    expect(titleMatches("Hard Case for Sony WH-1000XM5", xm5.rules)).toBe(false);
    expect(titleMatches("Sony Wh-1000xm5 Over-Ear Headphones + Jbl T110 In Ear", xm5.rules)).toBe(false);
    expect(titleMatches("Sony WH-1000XM5 Headphones (Black) | Pro Stand Bundle", xm5.rules)).toBe(false);
    expect(titleMatches("Sony WH-1000XM5 w/ charger", xm5.rules)).toBe(false);
    const keurig = LIVE_VARIANT_BY_ID.get("var_live_keurig_k_mini_black")!.rules;
    expect(titleMatches("Keurig K-Mini Single Serve Coffee Maker - Black", keurig)).toBe(true);
    expect(titleMatches("Keurig K-Mini Go Single Serve K-Cup Pod Coffee Maker", keurig)).toBe(false);
    expect(titleMatches("Keurig K-Mini Mate Single Serve Coffee Maker", keurig)).toBe(false);
    const buds = LIVE_VARIANT_BY_ID.get("var_live_samsung_buds3_pro_silver")!.rules;
    expect(titleMatches("Écouteurs Samsung Galaxy Buds3 Pro (Blanc)", buds)).toBe(false);
    expect(titleMatches("Nespresso Vertuo Next Deluxe by Breville", LIVE_VARIANT_BY_ID.get("var_live_nespresso_vertuo_next_black")!.rules)).toBe(false);
  });
  it("monitor variants don't absorb sibling models", () => {
    const asus = LIVE_VARIANT_BY_ID.get("var_live_asus_vg27aq")!.rules;
    expect(titleMatches("ASUS TUF Gaming VG27AQ 27\" 165Hz", asus)).toBe(true);
    expect(titleMatches("ASUS TUF Gaming VG27AQ1A 27\" 170Hz", asus)).toBe(false);
    expect(titleMatches("ASUS TUF Gaming VG27AQL1A", asus)).toBe(false);
  });
  it("size/edition requirements apply (Instant Pot 6 qt only; AirPods USB-C only)", () => {
    const ip = LIVE_VARIANT_BY_ID.get("var_live_instant_pot_duo_6qt")!.rules;
    expect(titleMatches("Instant Pot Duo 7-in-1 Electric Pressure Cooker, 6 Quart", ip)).toBe(true);
    expect(titleMatches("Instant Pot Duo 7-in-1 Pressure Cooker 8 Quart", ip)).toBe(false);
    expect(titleMatches("Instant Pot Duo Plus 9-in-1 6 Quart", ip)).toBe(false);
    expect(titleMatches("Instant Pot Duo 7-in-1", ip)).toBe(false);
    const ap = LIVE_VARIANT_BY_ID.get("var_live_apple_airpods_pro2_usbc")!.rules;
    expect(titleMatches("Apple AirPods Pro 2 with MagSafe Case (USB-C)", ap)).toBe(true);
    expect(titleMatches("Apple AirPods Pro (2nd generation) with MagSafe Case (USB‑C)", ap)).toBe(true);
    expect(titleMatches("Apple AirPods Pro 2 Lightning case", ap)).toBe(false);
  });
  it("every tracked variant has a query and at least one positive phrase", () => {
    expect(LIVE_VARIANTS).toHaveLength(15);
    expect(new Set(LIVE_VARIANTS.map((v) => v.variantId)).size).toBe(15);
    for (const v of LIVE_VARIANTS) {
      expect(v.query.length).toBeGreaterThan(3);
      expect(v.rules.any.length).toBeGreaterThan(0);
      expect(v.attributes.market).toBe("CA");
    }
  });
});

describe("attribution to the tracked variant", () => {
  const a = attributeOffers(xm5, parseShoppingResponse(FIXTURE, xm5.query).offers, clock.now());
  const by = (seller: string, cond = "new") => a.listings.find((l) => l.sellerName === seller && l.condition === cond);

  it("keeps matching results, one per seller+condition at the lowest price", () => {
    expect(a.listings.map((l) => `${l.sellerName}|${l.condition}`).sort()).toEqual(
      ["Amazon.ca|new", "B&H|new", "Best Buy|new", "Costco|new", "Staples|new", "Walmart.ca|new", "audio_outlet|refurbished"].sort(),
    );
    expect(by("Best Buy")!.itemPrice).toEqual({ amountMinor: "38999", currency: "CAD" });
  });
  it("applies the data policy: in stock, fees none, shipping only when stated", () => {
    for (const l of a.listings) {
      expect(l.sourceMode).toBe("live");
      expect(l.stock).toBe("in_stock");
      expect(l.feeStatus).toBe("complete");
      expect(l.mandatoryFees?.amountMinor).toBe("0");
      expect(l.brand).toBe("Sony");
      expect(l.model).toBe("WH-1000XM5");
      expect(() => validateListing(l)).not.toThrow();
    }
    expect(by("Amazon.ca")!.shipping).toMatchObject({ kind: "known", amount: { amountMinor: "999" } });
    expect(by("Walmart.ca")!.shipping.kind).toBe("unknown");
    expect(by("Costco")!.shipping.kind).toBe("threshold");
    expect(by("Staples")!.shipping).toMatchObject({ kind: "known", amount: { amountMinor: "1200" } });
    expect(by("audio_outlet", "refurbished")!.platform).toBe("eBay");
  });
  it("listing ids are stable across refreshes (variant + seller + condition)", async () => {
    const again = attributeOffers(xm5, parseShoppingResponse(FIXTURE, xm5.query).offers, new Date("2026-11-08T15:00:00Z"));
    expect(again.listings.map((l) => l.externalListingId).sort()).toEqual(a.listings.map((l) => l.externalListingId).sort());
    expect(by("Best Buy")!.externalListingId).toBe("var_live_sony_wh1000xm5_black:best-buy:new");
  });
  it("drops implausibly cheap matches (below 40% of the median price)", () => {
    const parsed = parseShoppingResponse(
      { shopping_results: [...FIXTURE.shopping_results, { position: 20, title: "SONY ヘッドフォン WH-1000XM5 Sony WH 1000XM5 Wireless", source: "developmentwebsite.ca", price: "$69.19", extracted_price: 69.19 }] },
      xm5.query,
    );
    const b = attributeOffers(xm5, parsed.offers, clock.now());
    expect(b.implausible).toBe(1);
    expect(b.listings.some((l) => l.sellerName === "developmentwebsite.ca")).toBe(false);
    expect(b.listings).toHaveLength(7);
  });
  it("applies the product's price floor and treats graded items as used", () => {
    const parsed = parseShoppingResponse({ shopping_results: [{ position: 1, title: "Sony WH-1000XM5 Black | Made in China", source: "cheapdeals", price: "$68.50", extracted_price: 68.5 }] }, xm5.query);
    expect(attributeOffers(xm5, parsed.offers, clock.now())).toMatchObject({ listings: [], implausible: 1 });
    expect(parseCondition("Apple AirPods Pro 2 USB-C, Grade A", [])).toBe("used");
  });
});

describe("HTTP connector (stubbed fetch)", () => {
  const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  const make = (fetchImpl: typeof fetch) => new SerpApiShoppingProvider({ apiKey: "k_test_secret", clock, fetchImpl });

  it("sends a Canadian google_shopping query and never leaks the key in errors", async () => {
    let url = "";
    const p = make((async (u: string) => {
      url = u;
      return new Response(JSON.stringify({ error: "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key" }), { status: 401 });
    }) as unknown as typeof fetch);
    const e = await p.sweep(xm5).catch((x) => x);
    const qs = new URL(url).searchParams;
    expect([qs.get("engine"), qs.get("gl"), qs.get("google_domain"), qs.get("q")]).toEqual(["google_shopping", "ca", "google.ca", xm5.query]);
    expect(e).toBeInstanceOf(ProviderError);
    expect(e.code).toBe("invalid_credentials");
    expect(String(e.message)).not.toContain("k_test_secret");
  });
  it("maps quota, server errors, network failures and no-results", async () => {
    await expect(make(ok({ error: "Your account has run out of searches." }, 429) as unknown as typeof fetch).sweep(xm5)).rejects.toMatchObject({ code: "quota_exhausted" });
    await expect(make(ok({ error: "boom" }, 503) as unknown as typeof fetch).sweep(xm5)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    await expect(make((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch).sweep(xm5)).rejects.toMatchObject({ code: "temporarily_unavailable" });
    const empty = await make(ok({ search_metadata: { status: "Success" }, error: "Google Shopping hasn't returned any results for this query." }) as unknown as typeof fetch).sweep(xm5);
    expect(empty.listings).toEqual([]);
    await expect(make((async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch).sweep(xm5)).rejects.toMatchObject({ code: "invalid_response" });
  });
  it("sweeps a fixture into validated listings; per-listing lookup is unsupported", async () => {
    const p = make(ok(FIXTURE) as unknown as typeof fetch);
    const s = await p.sweep(xm5);
    expect(s.listings.length).toBe(7);
    expect(p.capabilities().lookup).toBe(false);
    await expect(p.lookup({ externalListingId: "x", externalVariantKey: "", sellerKey: "y", contextKey: "ca-national" })).rejects.toMatchObject({ code: "unsupported_operation" });
  });
});

describe("Ninja air fryer (Canadian AF100C)", () => {
  const ninja = LIVE_VARIANT_BY_ID.get("var_live_ninja_af101")!.rules;
  it("matches AF100C, not the red AF100CRD or other models", () => {
    expect(titleMatches("Ninja Air Fryer af100c", ninja)).toBe(true);
    expect(titleMatches("Ninja Air Fryer af100crd", ninja)).toBe(false);
    expect(titleMatches("Ninja Air Fryer Pro 4-in-1 with 5 QT Capacity af141", ninja)).toBe(false);
    expect(titleMatches("Ninja 4 Qt. Air Fryer", ninja)).toBe(false);
  });
});
