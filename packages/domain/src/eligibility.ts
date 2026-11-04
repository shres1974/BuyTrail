/**
 * Comparison eligibility and ranking (Section 13). Known total before tax =
 * item price + known shipping + known mandatory fees. Unknown is never zero.
 */
import { addMoney, Currency, Money, subtractMoney } from "./money";

export type Condition = "new" | "refurbished" | "used" | "unknown";
export type Stock = "in_stock" | "out_of_stock" | "unknown";
export type MatchStatus = "verified" | "candidate" | "quarantined" | "unmatched" | "rejected";
export type AnomalyStatus = "none" | "pending_verification" | "confirmed" | "rejected";

export type ShippingInfo =
  | { kind: "known"; amount: Money; conditionalThreshold?: Money | null }
  | { kind: "unknown"; reason: string }
  /** Free/discounted shipping only when the basket reaches a threshold (G09). */
  | { kind: "threshold"; belowAmount: Money | null; freeAtOrAbove: Money };

export type PriceRestriction =
  | { kind: "membership"; program: string }
  | { kind: "coupon"; code?: string }
  | { kind: "subscription" }
  | { kind: "trade_in" };

export type OfferForComparison = {
  offerId: string;
  listingId: string;
  variantId: string | null;
  matchStatus: MatchStatus;
  condition: Condition;
  market: string;
  quantity: number;
  contextId: string;
  stock: Stock;
  itemPrice: Money | null;
  shipping: ShippingInfo;
  mandatoryFees: Money | null;
  feeStatus: "complete" | "unknown";
  /** Effective expiry (strictest of source validity, retention, freshness). */
  expiresAt: Date | null;
  displayAllowed: boolean;
  anomaly: AnomalyStatus;
  restrictions: PriceRestriction[];
};

export type ComparisonRequest = {
  variantId: string;
  condition: Exclude<Condition, "unknown">;
  market: "CA";
  currency: Currency;
  quantity: number;
  contextId: string;
  /** Membership programs the user has explicitly declared; MVP: none. */
  memberships?: string[];
  now: Date;
};

export type IneligibleReason =
  | "not_verified_match"
  | "wrong_variant"
  | "wrong_condition"
  | "wrong_market"
  | "wrong_currency"
  | "wrong_quantity"
  | "wrong_context"
  | "not_in_stock"
  | "stock_unknown"
  | "item_price_unavailable"
  | "shipping_unknown"
  | "fees_unknown"
  | "stale"
  | "display_not_permitted"
  | "anomaly_pending"
  | "restricted_price";

export type ShippingResolution = { known: true; amount: Money } | { known: false; reason: string };

/** Evaluate shipping for the MVP basket of one unit at the given item price (G09). */
export function resolveShipping(shipping: ShippingInfo, itemPrice: Money | null, quantity: number): ShippingResolution {
  if (shipping.kind === "known") return { known: true, amount: shipping.amount };
  if (shipping.kind === "unknown") return { known: false, reason: shipping.reason };
  if (!itemPrice) return { known: false, reason: "item_price_unavailable" };
  const basket = { amountMinor: itemPrice.amountMinor * BigInt(quantity), currency: itemPrice.currency };
  if (basket.currency !== shipping.freeAtOrAbove.currency) return { known: false, reason: "threshold_currency_mismatch" };
  if (basket.amountMinor >= shipping.freeAtOrAbove.amountMinor) {
    return { known: true, amount: { amountMinor: 0n, currency: basket.currency } };
  }
  return shipping.belowAmount
    ? { known: true, amount: shipping.belowAmount }
    : { known: false, reason: "below_free_shipping_threshold_fee_unknown" };
}

export type EvaluatedOffer = {
  offer: OfferForComparison;
  eligible: boolean;
  reasons: IneligibleReason[];
  knownTotal: Money | null;
  shippingResolved: ShippingResolution;
  stale: boolean;
};

export function isFresh(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

export function evaluateOffer(o: OfferForComparison, req: ComparisonRequest): EvaluatedOffer {
  const reasons: IneligibleReason[] = [];
  if (o.matchStatus !== "verified") reasons.push("not_verified_match");
  if (o.variantId !== req.variantId) reasons.push("wrong_variant");
  if (o.condition !== req.condition) reasons.push("wrong_condition");
  if (o.market !== req.market) reasons.push("wrong_market");
  if (o.quantity !== req.quantity) reasons.push("wrong_quantity");
  if (o.contextId !== req.contextId) reasons.push("wrong_context");
  if (o.stock === "out_of_stock") reasons.push("not_in_stock");
  if (o.stock === "unknown") reasons.push("stock_unknown");
  if (!o.itemPrice) reasons.push("item_price_unavailable");
  if (o.itemPrice && o.itemPrice.currency !== req.currency) reasons.push("wrong_currency");
  const shippingResolved = resolveShipping(o.shipping, o.itemPrice, req.quantity);
  if (!shippingResolved.known) reasons.push("shipping_unknown");
  if (shippingResolved.known && shippingResolved.amount.currency !== req.currency) reasons.push("wrong_currency");
  if (o.feeStatus !== "complete") reasons.push("fees_unknown");
  if (o.mandatoryFees && o.mandatoryFees.currency !== req.currency) reasons.push("wrong_currency");
  const stale = !isFresh(o.expiresAt, req.now);
  if (stale) reasons.push("stale");
  if (!o.displayAllowed) reasons.push("display_not_permitted");
  if (o.anomaly === "pending_verification" || o.anomaly === "rejected") reasons.push("anomaly_pending");
  const memberships = new Set(req.memberships ?? []);
  if (o.restrictions.some((r) => !(r.kind === "membership" && memberships.has(r.program)))) {
    reasons.push("restricted_price");
  }

  let knownTotal: Money | null = null;
  const currenciesOk = !reasons.includes("wrong_currency");
  if (o.itemPrice && shippingResolved.known && o.feeStatus === "complete" && currenciesOk) {
    const fees = o.mandatoryFees ?? { amountMinor: 0n, currency: o.itemPrice.currency };
    knownTotal = addMoney(o.itemPrice, shippingResolved.amount, fees);
  }
  const unique = [...new Set(reasons)];
  return { offer: o, eligible: unique.length === 0 && knownTotal !== null, reasons: unique, knownTotal, shippingResolved, stale };
}

export type ComparisonResult = {
  /** Eligible offers ranked by known total, then stable offerId tie-breaker. */
  ranked: Array<EvaluatedOffer & { rank: number }>;
  /** Matches the request but total cannot be confirmed (shipping/fees unknown). Not ranked. */
  incompleteTotal: EvaluatedOffer[];
  /** Matching variant/condition but stale; shown with a warning, excluded from alerts. */
  stale: EvaluatedOffer[];
  /** Everything else that is shown for transparency (out of stock, other currency, restricted, pending). */
  other: EvaluatedOffer[];
  best: (EvaluatedOffer & { rank: number }) | null;
};

const INCOMPLETE_ONLY: IneligibleReason[] = ["shipping_unknown", "fees_unknown"];

export function compareOffers(offers: OfferForComparison[], req: ComparisonRequest): ComparisonResult {
  const evaluated = offers.map((o) => evaluateOffer(o, req));
  const eligible = evaluated
    .filter((e) => e.eligible)
    .sort((a, b) => {
      const d = subtractMoney(a.knownTotal!, b.knownTotal!);
      if (d !== 0n) return d < 0n ? -1 : 1;
      return a.offer.offerId < b.offer.offerId ? -1 : a.offer.offerId > b.offer.offerId ? 1 : 0;
    })
    .map((e, i) => ({ ...e, rank: i + 1 }));
  const rest = evaluated.filter((e) => !e.eligible);
  const incompleteTotal = rest.filter((e) => e.reasons.length > 0 && e.reasons.every((r) => INCOMPLETE_ONLY.includes(r)));
  const stale = rest.filter((e) => !incompleteTotal.includes(e) && e.reasons.includes("stale"));
  const other = rest.filter((e) => !incompleteTotal.includes(e) && !stale.includes(e));
  return { ranked: eligible, incompleteTotal, stale, other, best: eligible[0] ?? null };
}

/** Deterministic explanation text for why the winner ranks ahead (Section 26.2 fallback). */
export function explainDifference(winner: EvaluatedOffer, other: EvaluatedOffer, fmt: (m: Money) => string): string | null {
  if (!winner.knownTotal || !other.knownTotal) return null;
  const diff = subtractMoney(other.knownTotal, winner.knownTotal);
  if (diff <= 0n) return null;
  return `${fmt({ amountMinor: diff, currency: winner.knownTotal.currency })} less than the other offer's known total before tax at the time checked.`;
}
