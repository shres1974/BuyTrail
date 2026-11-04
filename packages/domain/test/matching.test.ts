import { describe, expect, it } from "vitest";
import { gtinCheckDigit, gtinCheckDigitValid, matchListing, normalizeGtin, normalizeMpn, VariantForMatch, ListingForMatch } from "../src";

const gtin = (body12: string) => body12 + gtinCheckDigit(body12); // GTIN-13

const v27qhd: VariantForMatch = {
  variantId: "var_mon_27q",
  category: "monitors",
  brand: "Lumora",
  modelCode: "LV27-Q165",
  identifiers: [{ kind: "gtin", normalized: gtin("062800000011").padStart(14, "0") }],
  attributes: { screen_size_in: "27", resolution: "2560x1440", refresh_hz: "165", bundle: "standard", market: "CA" },
};
const v27qhdB: VariantForMatch = {
  variantId: "var_mon_27qb",
  category: "monitors",
  brand: "Lumora",
  modelCode: "LV27-Q165B",
  identifiers: [{ kind: "gtin", normalized: gtin("062800000028").padStart(14, "0") }],
  attributes: { screen_size_in: "27", resolution: "2560x1440", refresh_hz: "165", bundle: "with stand", market: "CA" },
};
const kettle1: VariantForMatch = {
  variantId: "var_kettle_1_7",
  category: "small_appliances",
  brand: "Hearthly",
  modelCode: "HK-200",
  identifiers: [],
  attributes: { capacity: "1.7L", colour: "white", voltage: "120V", bundle: "standard", market: "CA" },
};
const kettle1_0: VariantForMatch = { ...kettle1, variantId: "var_kettle_1_0", attributes: { ...kettle1.attributes, capacity: "1.0L" } };
const variants = [v27qhd, v27qhdB, kettle1, kettle1_0];

const listing = (o: Partial<ListingForMatch>): ListingForMatch => ({
  brand: "Lumora",
  model: "LV27-Q165",
  identifiers: [],
  attributes: { screen_size_in: "27 in", resolution: "2560x1440", refresh_hz: "165Hz", bundle: "standard", market: "CA" },
  title: "Lumora 27in QHD monitor",
  ...o,
});

describe("identifiers", () => {
  it("validates GTIN check digits and preserves leading zeros", () => {
    const g = gtin("006280000001");
    expect(gtinCheckDigitValid(g)).toBe(true);
    const n = normalizeGtin(g);
    expect(n.ok && n.normalized).toBe("0" + g);
    expect(n.ok && n.normalized.startsWith("00")).toBe(true);
    // GTIN-12 and its GTIN-13 zero-padded form normalize to the same GTIN-14.
    const upc = "036000291452";
    expect(normalizeGtin(upc).ok && normalizeGtin("0" + upc).ok).toBe(true);
    expect((normalizeGtin(upc) as { normalized: string }).normalized).toBe((normalizeGtin("0" + upc) as { normalized: string }).normalized);
  });
  it("rejects bad check digits, lengths and non-numerics", () => {
    expect(normalizeGtin("036000291453")).toMatchObject({ ok: false, reason: "bad_check_digit" });
    expect(normalizeGtin("12345")).toMatchObject({ ok: false, reason: "invalid_length" });
    expect(normalizeGtin("03600029145X")).toMatchObject({ ok: false, reason: "non_numeric" });
  });
  it("normalizes MPN separators and case", () => {
    expect(normalizeMpn(" lv27-q165 ")).toMatchObject({ ok: true, normalized: "LV27Q165" });
  });
});

describe("R01 exact variant matching", () => {
  it("verifies when brand+model and every critical attribute agree", () => {
    const d = matchListing(listing({}), variants);
    expect(d).toMatchObject({ status: "verified", variantId: "var_mon_27q" });
  });
  it("verifies via GTIN with agreeing attributes", () => {
    const d = matchListing(listing({ model: null, identifiers: [{ kind: "gtin", value: gtin("062800000011") }] }), variants);
    expect(d).toMatchObject({ status: "verified", variantId: "var_mon_27q" });
  });
  it("G04: same title, different model suffix → no automatic merge", () => {
    const d = matchListing(listing({ model: "LV27-Q165X", title: "Lumora 27in QHD monitor" }), variants);
    expect(d.status).not.toBe("verified");
    // Near model code (extends a known model) goes to review rather than being dropped.
    expect(d).toMatchObject({ status: "candidate", reason: "near_model_code" });
  });
  it("G05: same model, different capacity → separate variant, not merged into wrong one", () => {
    const d = matchListing(
      { brand: "Hearthly", model: "HK-200", identifiers: [], attributes: { capacity: "1.0 L", colour: "white", voltage: "120V", bundle: "standard", market: "CA" }, title: "Hearthly kettle" },
      variants,
    );
    expect(d).toMatchObject({ status: "verified", variantId: "var_kettle_1_0" });
    const unknownCap = matchListing(
      { brand: "Hearthly", model: "HK-200", identifiers: [], attributes: { colour: "white", voltage: "120V", bundle: "standard", market: "CA" }, title: "Hearthly kettle" },
      variants,
    );
    expect(unknownCap.status).toBe("candidate");
  });
  it("G05: bundle difference with same GTIN → quarantine", () => {
    const d = matchListing(listing({ identifiers: [{ kind: "gtin", value: gtin("062800000011") }], attributes: { ...listing({}).attributes, bundle: "with stand" } }), variants);
    expect(d).toMatchObject({ status: "quarantined", reason: "identifier_attribute_conflict" });
  });
  it("G07: invalid identifier → quarantine/review, never auto-match", () => {
    const bad = matchListing(listing({ model: null, identifiers: [{ kind: "gtin", value: "0628000000119" }] }), variants);
    expect(bad.status).toBe("quarantined");
    const badWithModel = matchListing(listing({ identifiers: [{ kind: "gtin", value: "0628000000119" }] }), variants);
    expect(badWithModel.status).toBe("candidate");
  });
  it("G07: valid GTIN contradicting model → quarantine", () => {
    const d = matchListing(listing({ model: "LV27-Q165B", identifiers: [{ kind: "gtin", value: gtin("062800000011") }] }), variants);
    expect(d).toMatchObject({ status: "quarantined", reason: "identifier_model_conflict" });
  });
  it("title similarity alone yields a candidate, not a verified match", () => {
    const d = matchListing(listing({ model: null, title: "Lumora LV27 monitor great deal" }), variants);
    expect(d.status).toBe("candidate");
  });
  it("changing irrelevant display text does not alter identity", () => {
    const a = matchListing(listing({ title: "A" }), variants);
    const b = matchListing(listing({ title: "Completely different marketing title!!" }), variants);
    expect(a).toEqual(b);
  });
});
