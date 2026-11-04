import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  addMoney,
  compareOffers,
  evaluateOffer,
  explainDifference,
  formatMoney,
  money,
  MoneyError,
  OfferForComparison,
  parseMajor,
  parseMinor,
  resolveShipping,
  toJSON,
  fromJSON,
  MAX_MINOR,
} from "../src";

const NOW = new Date("2026-11-04T15:00:00Z");
const LATER = new Date("2026-11-04T20:00:00Z");
const cad = (n: number) => money(BigInt(n), "CAD");

const base = (over: Partial<OfferForComparison>): OfferForComparison => ({
  offerId: "o",
  listingId: "l",
  variantId: "v1",
  matchStatus: "verified",
  condition: "new",
  market: "CA",
  quantity: 1,
  contextId: "ctx",
  stock: "in_stock",
  itemPrice: cad(10000),
  shipping: { kind: "known", amount: cad(0) },
  mandatoryFees: cad(0),
  feeStatus: "complete",
  expiresAt: LATER,
  displayAllowed: true,
  anomaly: "none",
  restrictions: [],
  ...over,
});
const req = { variantId: "v1", condition: "new" as const, market: "CA" as const, currency: "CAD" as const, quantity: 1, contextId: "ctx", now: NOW };

describe("R02 money", () => {
  it("parses and formats exactly", () => {
    expect(parseMajor("199.99")).toBe(19999n);
    expect(parseMajor("205")).toBe(20500n);
    expect(parseMajor("CAD 1,234.5")).toBe(123450n);
    expect(formatMoney(cad(19999))).toBe("CAD 199.99");
    expect(formatMoney(money(123456789n))).toBe("CAD 1,234,567.89");
  });
  it("rejects signs, fractions of minor units, junk and overflow", () => {
    for (const bad of ["-1", "+1", "1.5", "01", "", "1e3", " 5", "0x10"]) expect(() => parseMinor(bad)).toThrow(MoneyError);
    for (const bad of ["-1.00", "1.234", "abc", "1..2"]) expect(() => parseMajor(bad)).toThrow(MoneyError);
    expect(() => parseMinor((MAX_MINOR + 1n).toString())).toThrow(MoneyError);
    expect(() => money(1.5)).toThrow(MoneyError);
    expect(() => money(-1n)).toThrow(MoneyError);
  });
  it("refuses cross-currency arithmetic", () => {
    expect(() => addMoney(cad(1), money(1n, "USD"))).toThrow(MoneyError);
  });
  it("round-trips JSON as decimal strings (bigint is not JSON-serializable)", () => {
    const j = toJSON(cad(19999));
    expect(j).toEqual({ amountMinor: "19999", currency: "CAD" });
    expect(JSON.stringify(j)).toBe('{"amountMinor":"19999","currency":"CAD"}');
    expect(fromJSON(j).amountMinor).toBe(19999n);
  });
  it("property: addition is exact and associative for bounded values", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: MAX_MINOR }), fc.bigInt({ min: 0n, max: MAX_MINOR }), fc.bigInt({ min: 0n, max: MAX_MINOR }), (a, b, c) => {
        const s1 = addMoney(addMoney(cad(0), money(a), money(b)), money(c)).amountMinor;
        const s2 = addMoney(money(a), money(b), money(c)).amountMinor;
        return s1 === s2 && s1 === a + b + c;
      }),
    );
  });
  it("property: parseMajor(format(x)) round trips", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 99_999_999_999n }), (v) => parseMajor(formatMoney(money(v))) === v),
    );
  });
});

describe("golden comparison fixtures", () => {
  it("G01: CAD 205.00 free shipping beats CAD 199.99 + 9.99; difference CAD 4.98", () => {
    const pine = base({ offerId: "pine", itemPrice: cad(19999), shipping: { kind: "known", amount: cad(999) } });
    const cedar = base({ offerId: "cedar", itemPrice: cad(20500), shipping: { kind: "known", amount: cad(0) } });
    const r = compareOffers([pine, cedar], req);
    expect(r.ranked.map((x) => x.offer.offerId)).toEqual(["cedar", "pine"]);
    expect(r.ranked[0]!.knownTotal!.amountMinor).toBe(20500n);
    expect(r.ranked[1]!.knownTotal!.amountMinor).toBe(20998n);
    expect(explainDifference(r.ranked[0]!, r.ranked[1]!, formatMoney)).toContain("CAD 4.98 less");
  });
  it("G02: unknown shipping goes to incomplete-total group, never ranked", () => {
    const maple = base({ offerId: "maple", itemPrice: cad(18999), shipping: { kind: "unknown", reason: "not_provided" } });
    const cedar = base({ offerId: "cedar", itemPrice: cad(20500) });
    const r = compareOffers([maple, cedar], req);
    expect(r.best!.offer.offerId).toBe("cedar");
    expect(r.incompleteTotal.map((x) => x.offer.offerId)).toEqual(["maple"]);
    expect(r.incompleteTotal[0]!.knownTotal).toBeNull();
  });
  it("G03: USD offer excluded from CAD ranking", () => {
    const usd = base({ offerId: "usd", itemPrice: money(5000n, "USD"), shipping: { kind: "known", amount: money(0n, "USD") }, mandatoryFees: null });
    const r = compareOffers([usd], req);
    expect(r.ranked).toHaveLength(0);
    expect(r.other[0]!.reasons).toContain("wrong_currency");
  });
  it("G06: new vs refurbished are separate condition groups", () => {
    const refurb = base({ offerId: "refurb", condition: "refurbished", itemPrice: cad(5000) });
    const nu = base({ offerId: "new", itemPrice: cad(9000) });
    expect(compareOffers([refurb, nu], req).best!.offer.offerId).toBe("new");
    expect(compareOffers([refurb, nu], { ...req, condition: "refurbished" }).best!.offer.offerId).toBe("refurb");
    // Unknown condition never satisfies a "new" request.
    expect(evaluateOffer(base({ condition: "unknown" }), req).reasons).toContain("wrong_condition");
  });
  it("G08: members-only price excluded from default eligible total", () => {
    const member = base({ offerId: "member", itemPrice: cad(1000), restrictions: [{ kind: "membership", program: "PineClub" }] });
    const r = compareOffers([member], req);
    expect(r.ranked).toHaveLength(0);
    expect(r.other[0]!.reasons).toContain("restricted_price");
    // Explicitly declared membership would make it eligible.
    expect(compareOffers([member], { ...req, memberships: ["PineClub"] }).ranked).toHaveLength(1);
  });
  it("G09: free shipping only above CAD 250 does not apply to a CAD 205 item", () => {
    const thresholdUnknownBelow = base({ offerId: "t1", itemPrice: cad(20500), shipping: { kind: "threshold", belowAmount: null, freeAtOrAbove: cad(25000) } });
    const e = evaluateOffer(thresholdUnknownBelow, req);
    expect(e.eligible).toBe(false);
    expect(e.reasons).toEqual(["shipping_unknown"]);
    const thresholdKnownBelow = base({ offerId: "t2", itemPrice: cad(20500), shipping: { kind: "threshold", belowAmount: cad(1299), freeAtOrAbove: cad(25000) } });
    expect(evaluateOffer(thresholdKnownBelow, req).knownTotal!.amountMinor).toBe(21799n);
    expect(resolveShipping({ kind: "threshold", belowAmount: null, freeAtOrAbove: cad(25000) }, cad(26000), 1)).toEqual({ known: true, amount: cad(0) });
  });
  it("G11 (domain part): stale offers are not eligible", () => {
    const stale = base({ offerId: "s", expiresAt: new Date(NOW.getTime() - 1) });
    const r = compareOffers([stale], req);
    expect(r.ranked).toHaveLength(0);
    expect(r.stale).toHaveLength(1);
  });
  it("out of stock, unverified match, pending anomaly, missing item price are ineligible", () => {
    const cases: Array<[Partial<OfferForComparison>, string]> = [
      [{ stock: "out_of_stock" }, "not_in_stock"],
      [{ stock: "unknown" }, "stock_unknown"],
      [{ matchStatus: "candidate" }, "not_verified_match"],
      [{ anomaly: "pending_verification" }, "anomaly_pending"],
      [{ itemPrice: null }, "item_price_unavailable"],
      [{ feeStatus: "unknown" }, "fees_unknown"],
      [{ displayAllowed: false }, "display_not_permitted"],
      [{ quantity: 2 }, "wrong_quantity"],
    ];
    for (const [over, reason] of cases) {
      const e = evaluateOffer(base(over), req);
      expect(e.eligible, reason).toBe(false);
      expect(e.reasons).toContain(reason);
    }
  });
  it("property: an ineligible offer never becomes the ranked winner", () => {
    const arbOffer = fc.record({
      offerId: fc.string({ minLength: 1, maxLength: 4 }),
      price: fc.integer({ min: 0, max: 100000 }),
      ship: fc.option(fc.integer({ min: 0, max: 5000 }), { nil: null }),
      stock: fc.constantFrom("in_stock", "out_of_stock", "unknown"),
      condition: fc.constantFrom("new", "refurbished", "unknown"),
      match: fc.constantFrom("verified", "candidate"),
      stale: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(arbOffer, { maxLength: 8 }), (arr) => {
        const offers = arr.map((a) =>
          base({
            offerId: a.offerId,
            itemPrice: cad(a.price),
            shipping: a.ship === null ? { kind: "unknown", reason: "x" } : { kind: "known", amount: cad(a.ship) },
            stock: a.stock as never,
            condition: a.condition as never,
            matchStatus: a.match as never,
            expiresAt: a.stale ? new Date(NOW.getTime() - 1000) : LATER,
          }),
        );
        const r = compareOffers(offers, req);
        return r.ranked.every((x) => evaluateOffer(x.offer, req).eligible) &&
          (r.best === null || r.ranked.every((x) => x.knownTotal!.amountMinor >= r.best!.knownTotal!.amountMinor));
      }),
    );
  });
});
