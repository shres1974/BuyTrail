/**
 * Public catalog reads: comparison, search, history (Sections 13–15). Public queries never
 * touch private tables. Eligibility is always recomputed against the injected clock at read
 * time, so a cached summary can never keep an expired offer as "best".
 */
import type { DbOrTx, Prisma } from "@buytrail/db";
import {
  CATEGORIES,
  compareOffers,
  ComparisonResult,
  decodeCursor,
  encodeCursor,
  EvaluatedOffer,
  explainDifference,
  formatMoney,
  freshnessStatus,
  historyCoverageLabel,
  isCategoryKey,
  money,
  Money,
  normalizeModel,
  OfferForComparison,
  PriceRestriction,
  relativeAge,
  sha256,
  ShippingInfo,
  type CategoryKey,
  type Currency,
} from "@buytrail/domain";
import { parseCapabilities } from "./sources";
import { AppError, notFound } from "./errors";

export const PUBLIC_CONTEXT_ID = "ctx_demo_ca_standard";

type QuoteRow = Prisma.OfferQuoteGetPayload<{ include: { listing: { include: { merchant: true; source: true } } } }>;

const cur = (c: string): Currency => (c === "USD" ? "USD" : "CAD");
const m = (v: bigint | null, c: string): Money | null => (v === null ? null : money(v, cur(c)));

export function quoteToOffer(q: QuoteRow): OfferForComparison {
  const c = q.currency;
  let shipping: ShippingInfo;
  if (q.shippingStatus === "known") shipping = { kind: "known", amount: m(q.shippingMinor, c)! };
  else if (q.shippingStatus === "threshold")
    shipping = { kind: "threshold", freeAtOrAbove: m(q.shippingThresholdMinor, c)!, belowAmount: m(q.shippingMinor, c) };
  else shipping = { kind: "unknown", reason: q.shippingUnknownReason ?? "Shipping not provided by source" };
  const listing = q.listing;
  const caps = parseCapabilities(listing.source.capabilities);
  return {
    offerId: q.id,
    listingId: q.listingId,
    variantId: q.invalidatedAt ? null : listing.variantId,
    matchStatus: q.invalidatedAt ? "candidate" : (listing.matchStatus as OfferForComparison["matchStatus"]),
    condition: q.condition as OfferForComparison["condition"],
    market: listing.market,
    quantity: 1,
    contextId: q.contextId,
    stock: q.stock as OfferForComparison["stock"],
    itemPrice: m(q.itemPriceMinor, c),
    shipping,
    mandatoryFees: m(q.feesMinor, c),
    feeStatus: q.feeStatus as "complete" | "unknown",
    expiresAt: q.expiresAt,
    // Display permission: source must be enabled (or degraded but still approved) and not removed.
    displayAllowed: listing.source.status !== "disabled" && listing.removedAt === null && caps.lookup !== undefined,
    anomaly: q.anomalyStatus as OfferForComparison["anomaly"],
    restrictions: (q.restrictions as PriceRestriction[]) ?? [],
  };
}

export async function loadQuotes(db: DbOrTx, variantId: string, contextId: string) {
  return db.offerQuote.findMany({
    where: { contextId, listing: { variantId, matchStatus: "verified", removedAt: null } },
    include: { listing: { include: { merchant: true, source: true } } },
    orderBy: { id: "asc" },
  });
}

export async function compareVariant(
  db: DbOrTx,
  input: { variantId: string; contextId: string; condition: "new" | "refurbished" | "used"; now: Date },
): Promise<{ result: ComparisonResult; quotes: QuoteRow[] }> {
  const quotes = await loadQuotes(db, input.variantId, input.contextId);
  const result = compareOffers(quotes.map(quoteToOffer), {
    variantId: input.variantId,
    contextId: input.contextId,
    condition: input.condition,
    market: "CA",
    currency: "CAD",
    quantity: 1,
    now: input.now,
  });
  return { result, quotes };
}

// ── DTOs: money as decimal strings, explicit labels, never raw rows ──────────────────────

export type MoneyDTO = { amountMinor: string; currency: string; display: string };
const dto = (x: Money | null): MoneyDTO | null => (x ? { amountMinor: x.amountMinor.toString(), currency: x.currency, display: formatMoney(x) } : null);

const REASON_TEXT: Record<string, string> = {
  shipping_unknown: "Shipping unknown",
  fees_unknown: "Fees unknown",
  stale: "Price not recently confirmed",
  not_in_stock: "Out of stock",
  stock_unknown: "Stock unknown",
  wrong_currency: "Different currency (not compared)",
  restricted_price: "Conditional price (membership/coupon) — not compared",
  anomaly_pending: "Unusual price pending verification",
  item_price_unavailable: "Price unavailable",
  wrong_condition: "Different condition",
  not_verified_match: "Match under review",
  display_not_permitted: "Source not currently displayable",
};

export function offerDTO(e: EvaluatedOffer, q: QuoteRow, now: Date, rank: number | null) {
  const o = e.offer;
  const shippingText =
    o.shipping.kind === "known"
      ? o.shipping.amount.amountMinor === 0n
        ? "Shipping included (confirmed free)"
        : `${formatMoney(o.shipping.amount)} shipping`
      : o.shipping.kind === "threshold"
        ? e.shippingResolved.known
          ? `${formatMoney(e.shippingResolved.amount)} shipping (threshold rule applied)`
          : `Free shipping only at or above ${formatMoney(o.shipping.freeAtOrAbove)}; shipping for this item unknown`
        : "Shipping unknown";
  return {
    offerId: o.offerId,
    rank,
    merchant: { name: q.listing.merchant?.name ?? q.listing.sellerKey, platform: q.listing.merchant?.platform ?? null },
    source: { id: q.listing.sourceId, mode: q.listing.source.mode, name: q.listing.source.name },
    condition: o.condition,
    stock: o.stock,
    itemPrice: dto(o.itemPrice),
    shippingText,
    fees: dto(o.mandatoryFees),
    feeStatus: o.feeStatus,
    knownTotal: dto(e.knownTotal),
    eligible: e.eligible,
    reasons: e.reasons,
    reasonText: e.reasons.map((r) => REASON_TEXT[r] ?? r),
    restrictions: o.restrictions,
    freshness: freshnessStatus(o.expiresAt, now),
    checkedAt: q.lastSuccessfulCheckAt.toISOString(),
    checkedAgo: relativeAge(q.lastSuccessfulCheckAt, now),
    sourceObservedAt: q.sourceObservedAt?.toISOString() ?? null,
    lastCheckFailedAt: q.lastCheckFailedAt?.toISOString() ?? null,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    outboundUrl: q.listing.outboundUrl,
    isDemo: q.listing.isDemo,
  };
}

export type OfferDTO = ReturnType<typeof offerDTO>;

export async function variantOffers(db: DbOrTx, variantId: string, contextId: string, condition: "new" | "refurbished" | "used", now: Date) {
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant) throw notFound("Variant");
  const { result, quotes } = await compareVariant(db, { variantId, contextId, condition, now });
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const ranked = result.ranked.map((e) => offerDTO(e, byId.get(e.offer.offerId)!, now, e.rank));
  const best = result.best;
  const second = result.ranked[1];
  const explanation =
    best && second ? explainDifference(best, second, formatMoney)?.replace("the other offer's", `${byId.get(second.offer.offerId)!.listing.merchant?.name ?? "the next offer"}'s`) ?? null : null;
  // Condition groups available for this variant (G06).
  const conditions = [...new Set(quotes.map((q) => q.condition).filter((c) => c !== "unknown"))].sort();
  return {
    variantId,
    contextId,
    condition,
    isDemo: variant.isDemo,
    ranked,
    incompleteTotal: result.incompleteTotal.map((e) => offerDTO(e, byId.get(e.offer.offerId)!, now, null)),
    stale: result.stale.map((e) => offerDTO(e, byId.get(e.offer.offerId)!, now, null)),
    other: result.other
      .filter((e) => !e.reasons.includes("wrong_condition"))
      .map((e) => offerDTO(e, byId.get(e.offer.offerId)!, now, null)),
    conditionsAvailable: conditions,
    best: best ? { offerId: best.offer.offerId, knownTotal: dto(best.knownTotal) } : null,
    summary: best
      ? `Lowest eligible total among ${result.ranked.length} currently fresh offer${result.ranked.length === 1 ? "" : "s"}: ${formatMoney(best.knownTotal!)} before tax.`
      : "No eligible offer with a confirmed total right now.",
    explanation,
    taxNote: "Totals are item price + known shipping + known mandatory fees, before tax. Retailer checkout is authoritative.",
  };
}

// ── Product page ──────────────────────────────────────────────────────────────────────────

export async function productDetail(db: DbOrTx, productId: string) {
  const p = await db.product.findUnique({
    where: { id: productId },
    include: { variants: { orderBy: { id: "asc" }, include: { identifiers: true } } },
  });
  if (!p) throw notFound("Product");
  const cat = isCategoryKey(p.category) ? CATEGORIES[p.category] : null;
  return {
    id: p.id,
    title: p.title,
    brand: p.brand,
    family: p.family,
    category: p.category,
    categoryLabel: cat?.label ?? p.category,
    description: p.description,
    isDemo: p.isDemo,
    attributeDefs: cat?.attributes ?? [],
    variants: p.variants.map((v) => ({
      id: v.id,
      modelCode: v.modelCode,
      label: v.label,
      attributes: v.attributes as Record<string, string>,
      identifiers: v.identifiers.map((i) => ({ kind: i.kind, value: i.original })),
    })),
  };
}

// ── History (Section 15) ─────────────────────────────────────────────────────────────────

export async function variantHistory(db: DbOrTx, variantId: string, contextId: string, condition: string, now: Date) {
  const listings = await db.sourceListing.findMany({ where: { variantId, matchStatus: "verified" }, include: { source: true, merchant: true } });
  const allowed = listings.filter((l) => l.source.historyRetentionDays !== null && parseCapabilities(l.source.capabilities).historyAllowed);
  if (allowed.length === 0) {
    return { available: false as const, reason: "The current sources for this item do not permit price history storage." };
  }
  const obs = await db.priceObservation.findMany({
    where: {
      listingId: { in: allowed.map((l) => l.id) },
      contextId,
      condition,
      currency: "CAD",
      retainUntil: { gt: now },
      // Only observations made while the listing was mapped to this variant.
      variantIdAtObservation: variantId,
    },
    orderBy: [{ fetchedAt: "asc" }, { id: "asc" }],
    take: 5000,
  });
  if (obs.length === 0) return { available: false as const, reason: "No observations retained yet." };
  // Daily lowest known total across sources, and daily lowest item price — kept separate.
  const days = new Map<string, { total: bigint | null; item: bigint | null; count: number }>();
  for (const o of obs) {
    const d = o.fetchedAt.toISOString().slice(0, 10);
    const e = days.get(d) ?? { total: null, item: null, count: 0 };
    e.count++;
    if (o.knownTotalMinor !== null && o.stock === "in_stock" && (e.total === null || o.knownTotalMinor < e.total)) e.total = o.knownTotalMinor;
    if (o.itemPriceMinor !== null && (e.item === null || o.itemPriceMinor < e.item)) e.item = o.itemPriceMinor;
    days.set(d, e);
  }
  const sorted = [...days.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  // Gaps: missing calendar days between first and last observed day. A gap is never a zero.
  const gaps: string[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(`${sorted[i - 1]![0]}T00:00:00Z`).getTime();
    const curD = new Date(`${sorted[i]![0]}T00:00:00Z`).getTime();
    const missing = Math.round((curD - prev) / 86400_000) - 1;
    if (missing > 0) gaps.push(`${missing} day${missing === 1 ? "" : "s"} without observations before ${sorted[i]![0]}`);
  }
  const first = obs[0]!.fetchedAt;
  const totals = sorted.map(([, v]) => v.total).filter((x): x is bigint => x !== null);
  const lowest = totals.length ? totals.reduce((a, b) => (b < a ? b : a)) : null;
  const fmtDate = (d: Date) => d.toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  return {
    available: true as const,
    isDemo: allowed.every((l) => l.isDemo),
    series: "Daily lowest known total before tax across sources (in stock only); item price shown separately",
    condition,
    currency: "CAD",
    contextId,
    firstObservedAt: first.toISOString(),
    lastObservedAt: obs.at(-1)!.fetchedAt.toISOString(),
    observationCount: obs.length,
    sources: [...new Set(allowed.map((l) => l.merchant?.name ?? l.sellerKey))],
    points: sorted.map(([date, v]) => ({
      date,
      lowestKnownTotal: v.total === null ? null : dto(money(v.total)),
      lowestItemPrice: v.item === null ? null : dto(money(v.item)),
      observations: v.count,
    })),
    gaps,
    lowestLabel: lowest !== null ? `${historyCoverageLabel(first, 30, now, fmtDate)}: ${formatMoney(money(lowest))}` : null,
    coverageLabel: `Price history since ${fmtDate(first)}`,
  };
}

// ── Search (Section 14) ──────────────────────────────────────────────────────────────────

export type SearchParams = {
  q: string;
  category?: CategoryKey;
  condition?: "new" | "refurbished" | "used";
  filters?: Record<string, string>;
  sort?: "relevance" | "lowest_total";
  limit?: number;
  cursor?: string;
};

export const SEARCH_DEFAULT_LIMIT = 24;
export const SEARCH_MAX_LIMIT = 100;
export const SEARCH_MAX_QUERY = 200;

type Candidate = { productId: string; score: number; exact: boolean };

export async function searchCatalog(db: DbOrTx, params: SearchParams, now: Date, cursorSecret: string) {
  const q = params.q.trim().slice(0, SEARCH_MAX_QUERY);
  if (params.q.length > SEARCH_MAX_QUERY) throw new AppError("VALIDATION_FAILED", `Query must be at most ${SEARCH_MAX_QUERY} characters`);
  const limit = Math.min(Math.max(1, params.limit ?? SEARCH_DEFAULT_LIMIT), SEARCH_MAX_LIMIT);
  const condition = params.condition ?? "new";
  const sort = params.sort ?? "relevance";
  const filters = Object.fromEntries(Object.entries(params.filters ?? {}).filter(([, v]) => v !== ""));
  if (params.category) {
    const allowed = new Set(CATEGORIES[params.category].attributes.filter((a) => a.filterable).map((a) => a.key));
    for (const k of Object.keys(filters)) if (!allowed.has(k)) throw new AppError("VALIDATION_FAILED", `Unsupported filter ${k}`);
  } else if (Object.keys(filters).length) {
    throw new AppError("VALIDATION_FAILED", "Attribute filters require a category");
  }
  const sig = sha256(JSON.stringify({ q: q.toLowerCase(), c: params.category ?? null, cond: condition, f: filters, sort, limit })).slice(0, 16);

  let afterKey: unknown[] | null = null;
  if (params.cursor) {
    afterKey = decodeCursor(params.cursor, sig, cursorSecret);
    if (!afterKey) throw new AppError("VALIDATION_FAILED", "Invalid or mismatched cursor");
  }

  // 1. Candidate products with relevance score. Exact identifier / model first.
  const candidates = new Map<string, Candidate>();
  const add = (productId: string, score: number, exact: boolean) => {
    const prev = candidates.get(productId);
    if (!prev || score > prev.score) candidates.set(productId, { productId, score, exact: exact || (prev?.exact ?? false) });
  };
  const catFilter = params.category ? { category: params.category } : {};
  if (q === "") {
    for (const p of await db.product.findMany({ where: catFilter, select: { id: true }, take: 1000 })) add(p.id, 0, false);
  } else {
    const digits = q.replace(/[\s-]/g, "");
    if (/^\d{8,14}$/.test(digits)) {
      const ids = await db.productIdentifier.findMany({ where: { kind: "gtin", normalized: digits.padStart(14, "0") }, include: { variant: true } });
      for (const i of ids) add(i.variant.productId, 100, true);
    }
    const model = normalizeModel(q);
    if (model) {
      const vs = await db.productVariant.findMany({ where: { modelCodeNormalized: model }, select: { productId: true } });
      for (const v of vs) add(v.productId, 90, true);
    }
    // Per-token model match (e.g. "clearpeak cp27q").
    for (const tok of q.split(/\s+/)) {
      const tm = normalizeModel(tok);
      if (tm && tm !== model && /\d/.test(tm)) {
        const vs = await db.productVariant.findMany({ where: { modelCodeNormalized: tm }, select: { productId: true } });
        for (const v of vs) add(v.productId, 80, true);
      }
    }
    const catSql = params.category ? `AND p."category" = $2` : "";
    const args: unknown[] = [q];
    if (params.category) args.push(params.category);
    const rows = await db.$queryRawUnsafe<Array<{ id: string; score: number }>>(
      `SELECT p."id",
              (ts_rank(p."searchVector", websearch_to_tsquery('english', $1)) * 10
               + similarity(p."title", $1) * 5
               + COALESCE((SELECT max(similarity(v."modelCodeNormalized", upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g')))) FROM product_variant v WHERE v."productId" = p."id"), 0) * 5
              )::float8 AS score
         FROM product p
        WHERE (p."searchVector" @@ websearch_to_tsquery('english', $1)
               OR similarity(p."title", $1) > 0.15
               OR word_similarity($1, p."title") > 0.4
               OR EXISTS (SELECT 1 FROM product_variant v WHERE v."productId" = p."id"
                          AND similarity(v."modelCodeNormalized", upper(regexp_replace($1, '[^A-Za-z0-9]', '', 'g'))) > 0.35))
          ${catSql}
        ORDER BY score DESC, p."id" ASC
        LIMIT 500`,
      ...args,
    );
    for (const r of rows) add(r.id, Math.min(79, r.score), false);
    // Category phrase ("monitor", "kettle").
    const lower = q.toLowerCase();
    for (const [key, def] of Object.entries(CATEGORIES)) {
      const stem = def.label.toLowerCase().replace(/s$/, "");
      if (lower.includes(stem) || lower.includes(key.replace(/_/g, " ").replace(/s$/, ""))) {
        if (params.category && params.category !== key) continue;
        for (const p of await db.product.findMany({ where: { category: key }, select: { id: true } })) add(p.id, 1, false);
      }
    }
  }

  const products = await db.product.findMany({
    where: { id: { in: [...candidates.keys()] }, ...catFilter },
    include: { variants: { orderBy: { id: "asc" } } },
  });

  // 2. Per-product: compute fresh comparison summaries at render time (never from stale cache).
  const quotes = await db.offerQuote.findMany({
    where: { contextId: PUBLIC_CONTEXT_ID, listing: { variantId: { in: products.flatMap((p) => p.variants.map((v) => v.id)) }, matchStatus: "verified", removedAt: null } },
    include: { listing: { include: { merchant: true, source: true } } },
  });
  const byVariant = new Map<string, QuoteRow[]>();
  for (const q2 of quotes) {
    const k = q2.listing.variantId!;
    byVariant.set(k, [...(byVariant.get(k) ?? []), q2]);
  }

  type Row = {
    product: (typeof products)[number];
    matchingVariants: (typeof products)[number]["variants"];
    score: number;
    exact: boolean;
    bestTotal: bigint | null;
    eligibleCount: number;
    incompleteCount: number;
    latestCheck: Date | null;
    sources: Set<string>;
  };
  const rows: Row[] = [];
  for (const p of products) {
    const matchingVariants = p.variants.filter((v) => {
      const a = v.attributes as Record<string, string>;
      return Object.entries(filters).every(([k, val]) => (a[k] ?? "").toLowerCase() === val.toLowerCase());
    });
    if (matchingVariants.length === 0) continue;
    let bestTotal: bigint | null = null;
    let eligibleCount = 0;
    let incompleteCount = 0;
    let latestCheck: Date | null = null;
    const sources = new Set<string>();
    for (const v of matchingVariants) {
      const qs = byVariant.get(v.id) ?? [];
      const r = compareOffers(qs.map(quoteToOffer), { variantId: v.id, contextId: PUBLIC_CONTEXT_ID, condition, market: "CA", currency: "CAD", quantity: 1, now });
      eligibleCount += r.ranked.length;
      incompleteCount += r.incompleteTotal.length;
      if (r.best && (bestTotal === null || r.best.knownTotal!.amountMinor < bestTotal)) bestTotal = r.best.knownTotal!.amountMinor;
      for (const q3 of qs) {
        sources.add(q3.listing.sourceId);
        if (!latestCheck || q3.lastSuccessfulCheckAt > latestCheck) latestCheck = q3.lastSuccessfulCheckAt;
      }
    }
    const c = candidates.get(p.id)!;
    rows.push({ product: p, matchingVariants, score: c.score, exact: c.exact, bestTotal, eligibleCount, incompleteCount, latestCheck, sources });
  }

  // 3. Stable ordering. Relevance: exact → score → has eligible comparison → id.
  //    Lowest total: applies only after relevance filtering; products without eligible totals last.
  // Sort keys are string tuples compared lexicographically (ascending = better first).
  const BIG = 10n ** 15n;
  const keyOf = (r: Row): string[] => {
    if (sort === "lowest_total") {
      return [r.bestTotal === null ? "1" : "0", (r.bestTotal ?? BIG).toString().padStart(16, "0"), r.product.id];
    }
    // Relevance: exact match → higher score → has eligible comparison → stable id.
    const inv = String(Math.round((1000 - (r.exact ? 500 : 0) - Math.min(r.score, 499)) * 1000)).padStart(10, "0");
    return [inv, r.eligibleCount > 0 ? "0" : "1", r.product.id];
  };
  const cmpKey = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if ((a[i] ?? "") < (b[i] ?? "")) return -1;
      if ((a[i] ?? "") > (b[i] ?? "")) return 1;
    }
    return 0;
  };
  rows.sort((a, b) => cmpKey(keyOf(a), keyOf(b)));
  let start = 0;
  if (afterKey) {
    const ak = afterKey.map(String);
    start = rows.findIndex((r) => cmpKey(keyOf(r), ak) > 0);
    if (start < 0) start = rows.length;
  }
  const page = rows.slice(start, start + limit);
  const nextCursor = start + limit < rows.length ? encodeCursor({ sig, key: keyOf(page.at(-1)!) }, cursorSecret) : null;

  const coverage = await db.source.findMany({ where: { status: { not: "disabled" } }, select: { id: true, name: true, mode: true } });
  return {
    query: q,
    category: params.category ?? null,
    condition,
    sort,
    total: rows.length,
    items: page.map((r) => {
      const single = r.matchingVariants.length === 1 ? r.matchingVariants[0]! : null;
      const cat = isCategoryKey(r.product.category) ? CATEGORIES[r.product.category] : null;
      const distinguishing = single
        ? Object.entries(single.attributes as Record<string, string>)
            .filter(([k]) => cat?.attributes.find((a) => a.key === k && a.critical) && k !== "market")
            .map(([k, v]) => `${cat!.attributes.find((a) => a.key === k)!.label}: ${v}`)
        : [];
      return {
        productId: r.product.id,
        variantId: single?.id ?? null,
        variantCount: r.matchingVariants.length,
        title: r.product.title,
        brand: r.product.brand,
        category: r.product.category,
        modelCodes: [...new Set(r.matchingVariants.map((v) => v.modelCode))],
        distinguishing,
        imageUrl: null as string | null,
        eligibleOfferCount: r.eligibleCount,
        incompleteTotalCount: r.incompleteCount,
        bestKnownTotal: r.bestTotal === null ? null : dto(money(r.bestTotal)),
        priceLabel:
          r.bestTotal === null
            ? "No confirmed total right now"
            : single
              ? `From ${formatMoney(money(r.bestTotal))} before tax`
              : `From ${formatMoney(money(r.bestTotal))} before tax — choose a variant`,
        needsVariantChoice: !single,
        latestCheckAt: r.latestCheck?.toISOString() ?? null,
        sourceCount: r.sources.size,
        isDemo: r.product.isDemo,
      };
    }),
    nextCursor,
    coverage: {
      categories: Object.entries(CATEGORIES).map(([k, v]) => ({ key: k, label: v.label })),
      sources: coverage.map((s) => ({ id: s.id, name: s.name, mode: s.mode })),
      market: "Canada (CAD)",
    },
  };
}
