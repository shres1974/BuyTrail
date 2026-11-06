/**
 * SerpApi Google Shopping connector (Canada). One search per tracked variant returns offers from
 * many sellers; each accepted offer becomes one listing keyed by (variant, seller, condition), so
 * per-seller price history is stable across refreshes.
 *
 * Data policy (owner decision, docs/source-capabilities.md):
 *  - Listed results count as in stock unless the result says otherwise.
 *  - Shipping is known only when Google Shopping states it ("Free delivery", "$9.99 delivery");
 *    a "free over $X" rule is a threshold; anything else stays unknown (never zero).
 *  - Google Shopping lists the seller's price with no separate mandatory fees, so fees are none.
 *  - A result is attributed to a variant only if its title passes that variant's title rules.
 *
 * The API key is sent only to serpapi.com and never appears in errors or logs.
 */
import type { Clock } from "@buytrail/domain";
import { CatalogProvider, LookupInput, NormalizedListing, ProviderError, SearchInput, SearchResult, SourceCapabilities, validateListing } from "./contract";
import type { TitleRules, TrackedVariant } from "./live-catalog";

export const SERPAPI_SOURCE_ID = "serpapi-google-shopping";
export const SERPAPI_CONTEXT_KEY = "ca-national";
export const SERPAPI_ALLOWED_HOSTS = ["www.google.com", "www.google.ca", "google.com", "google.ca"];
const ENDPOINT = "https://serpapi.com/search.json";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_PRICE_MINOR = 10_000_000n; // CAD 100,000: anything above is not a consumer listing

export const SERPAPI_CAPS: SourceCapabilities = {
  search: true,
  // Offers are refreshed by per-variant sweeps; per-listing lookups would cost one credit each.
  lookup: false,
  shippingQuotes: false,
  historyAllowed: true,
  imageDisplayAllowed: false,
  maxBatchSize: 1,
  minimumRefreshSeconds: 12 * 3600,
};

// ── Parsing (pure) ───────────────────────────────────────────────────────────────────────

export type ShoppingOffer = {
  position: number;
  title: string;
  sellerName: string;
  platform: string | null;
  sellerSlug: string;
  currency: "CAD" | "USD";
  priceMinor: bigint;
  shipping: NormalizedListing["shipping"];
  condition: NormalizedListing["condition"];
  stock: NormalizedListing["stock"];
  outboundUrl: string;
  productId: string | null;
  /** Product thumbnail (https on serpapi.com / gstatic.com only); never displayed directly. */
  thumbnailUrl: string | null;
};

export type ParsedResponse = { offers: ShoppingOffer[]; skipped: number; total: number };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");

/** "$1,299.99" / 1299.99 → minor units. Rejects non-positive, non-finite and absurd values. */
export function toMinor(extracted: unknown, display: string | null): bigint | null {
  let major: string | null = null;
  if (typeof extracted === "number" && Number.isFinite(extracted) && extracted > 0) major = extracted.toFixed(2);
  else if (display) {
    const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(display);
    if (m) major = `${m[1]!.replace(/,/g, "")}.${(m[2] ?? "").padEnd(2, "0")}`;
  }
  if (!major) return null;
  const [w, f] = major.split(".") as [string, string];
  const v = BigInt(w) * 100n + BigInt(f.slice(0, 2).padEnd(2, "0"));
  return v > 0n && v <= MAX_PRICE_MINOR ? v : null;
}

/** Currency from the displayed price. Unknown symbols return null (the result is skipped). */
export function priceCurrency(display: string | null): "CAD" | "USD" | null {
  if (!display) return "CAD"; // gl=ca results without a display string are CAD-extracted
  if (/US\s?\$|USD/i.test(display)) return "USD";
  if (/\$|CAD/i.test(display)) return "CAD";
  return null;
}

const money = (minor: bigint, currency: "CAD" | "USD") => ({ amountMinor: minor.toString(), currency });

/** Interpret Google Shopping delivery text. Unknown is never treated as zero. */
export function parseDelivery(texts: string[], currency: "CAD" | "USD"): NormalizedListing["shipping"] {
  const t = texts.join(" · ").replace(/\s+/g, " ").trim();
  if (!t) return { kind: "unknown", reason: "Shipping not stated by Google Shopping" };
  const amount = (s: string) => toMinor(null, s);
  // "Free delivery on orders over $35" / "Free shipping $35+" → threshold (fee below it unknown).
  const thr = /free (?:delivery|shipping)[^·]*?(?:over|above|orders of|on orders(?: over)?|with orders(?: over)?)\s*(?:CA)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)|free (?:delivery|shipping)[^·]*?(?:CA)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*\+/i.exec(t);
  if (thr) {
    const v = amount(`$${thr[1] ?? thr[2]}`);
    if (v !== null) return { kind: "threshold", freeAtOrAbove: money(v, currency), belowAmount: null, contextKey: SERPAPI_CONTEXT_KEY };
  }
  // Only explicit statements count: "Free delivery", "Free shipping", "Delivery: free", "(Free)".
  if (/\bfree (?:delivery|shipping)\b|\b(?:delivery|shipping)\s*(?:is\s*)?:?\s*free\b|\(\s*free\s*\)/i.test(t)) {
    return { kind: "known", amount: money(0n, currency), contextKey: SERPAPI_CONTEXT_KEY };
  }
  // "$9.99 delivery", "+$10 shipping", "Delivery: $5", "Get it by Wed ($10)".
  const paid =
    /(?:CA)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*(?:delivery|shipping)\b/i.exec(t) ??
    /\b(?:delivery|shipping)\b[^·$]{0,10}(?:CA)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)/i.exec(t) ??
    /\b(?:get it|arrives|delivery)\b[^·(]*\(\s*(?:CA)?\$\s?(\d[\d,]*(?:\.\d{1,2})?)\s*\)/i.exec(t);
  if (paid) {
    const v = amount(`$${paid[1]}`);
    if (v !== null) return { kind: "known", amount: money(v, currency), contextKey: SERPAPI_CONTEXT_KEY };
  }
  return { kind: "unknown", reason: "Shipping not stated by Google Shopping" };
}

export function parseCondition(title: string, hints: string[]): NormalizedListing["condition"] {
  const t = ` ${normalizeText([title, ...hints].join(" "))} `;
  if (/ (refurbished|renewed|recertified|reconditioned) /.test(t)) return "refurbished";
  if (/ (used|pre owned|preowned|open box|second hand|secondhand|grade [a-d]|grade) /.test(t)) return "used";
  return "new";
}

/** Seller "eBay - shopname" → platform eBay, seller shopname. */
export function parseSeller(source: string): { sellerName: string; platform: string | null; sellerSlug: string } {
  const s = source.replace(/\s+/g, " ").trim().slice(0, 200);
  const m = /^(eBay|Amazon\.ca|Amazon|Walmart\.ca|Walmart|Best Buy Marketplace|Newegg\.ca|Newegg)\s+[-–|]\s+(.+)$/i.exec(s);
  const sellerName = m ? m[2]!.trim() : s;
  const platform = m ? m[1]!.trim() : null;
  const sellerSlug = (platform ? `${platform}-${sellerName}` : sellerName)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return { sellerName, platform, sellerSlug: sellerSlug || "unknown-seller" };
}

function safeOutbound(link: string | null, productLink: string | null, query: string): string {
  for (const raw of [link, productLink]) {
    if (!raw) continue;
    try {
      const u = new URL(decode(raw));
      if (u.protocol === "https:" && !u.username && !u.password && u.toString().length <= 2048) return u.toString();
    } catch {
      /* try the next candidate */
    }
  }
  return `https://www.google.ca/search?tbm=shop&q=${encodeURIComponent(query)}`;
}

/** Only fetchable from SerpApi's or Google's image CDNs over https. */
export const THUMBNAIL_HOSTS = [/^serpapi\.com$/, /^encrypted-tbn\d\.gstatic\.com$/];
export function safeThumbnail(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decode(raw));
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.toString().length > 2048) return null;
    return THUMBNAIL_HOSTS.some((h) => h.test(u.hostname)) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Parse a SerpApi google_shopping response. Unparseable results are counted and skipped. */
export function parseShoppingResponse(json: unknown, query: string): ParsedResponse {
  const root = (json ?? {}) as Record<string, unknown>;
  const lists = [root.shopping_results, root.inline_shopping_results].filter(Array.isArray) as unknown[][];
  const offers: ShoppingOffer[] = [];
  let skipped = 0;
  let total = 0;
  for (const list of lists) {
    for (const item of list) {
      total++;
      const r = (item ?? {}) as Record<string, unknown>;
      const title = str(r.title);
      const source = str(r.source) ?? str(r.seller);
      const display = str(r.price);
      if (!title || !source) {
        skipped++;
        continue;
      }
      // Instalment/subscription prices ("$29.99/mo") aren't comparable item prices.
      if (display && /\/\s?mo\b|per month|monthly|\/\s?month/i.test(display)) {
        skipped++;
        continue;
      }
      const currency = priceCurrency(display);
      const priceMinor = toMinor(r.extracted_price, display);
      if (!currency || priceMinor === null) {
        skipped++;
        continue;
      }
      const extensions = Array.isArray(r.extensions) ? (r.extensions.filter((e) => typeof e === "string") as string[]) : [];
      const deliveryTexts = [str(r.delivery), str(r.shipping), ...extensions.filter((e) => /deliver|shipping/i.test(e))].filter((x): x is string => !!x);
      const hints = [str(r.second_hand_condition), str(r.condition), str(r.tag), ...extensions].filter((x): x is string => !!x);
      const outOfStock = hints.some((h) => /out of stock|sold out|unavailable/i.test(h));
      const seller = parseSeller(decode(source));
      offers.push({
        position: typeof r.position === "number" ? r.position : total,
        title: decode(title).slice(0, 500),
        ...seller,
        currency,
        priceMinor,
        shipping: parseDelivery(deliveryTexts, currency),
        condition: parseCondition(title, hints),
        stock: outOfStock ? "out_of_stock" : "in_stock",
        outboundUrl: safeOutbound(str(r.link), str(r.product_link), query),
        productId: str(r.product_id),
        thumbnailUrl: safeThumbnail(str(r.serpapi_thumbnail) ?? str(r.thumbnail)),
      });
    }
  }
  return { offers, skipped, total };
}

// ── Title rules (pure) ───────────────────────────────────────────────────────────────────

/** Lower-case, strip accents and punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, " ")
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Accessories, parts, multi-packs and add-ons are never the tracked product. */
export const GLOBAL_EXCLUDE = [
  "case for", "cover for", "replacement", "ear pads", "earpads", "ear cushions", "cushions", "ear tips",
  "compatible with", "compatible for", "stand for", "mount for", "holder for", "protector", "skin", "decal",
  "strap", "carrying case", "hard case", "travel case", "parts", "accessory", "accessories", "filter",
  "gasket", "sealing ring", "basket only", "pitcher only", "variety pack",
  "bundle", "combo", "lot of", "pack of", "2 pack", "3 pack", "set of", "protection plan",
  "for parts", "not working", "dummy", "display model",
];

function phraseMatches(title: string, phrase: string): boolean {
  const prefix = phrase.endsWith("*");
  const p = normalizeText(prefix ? phrase.slice(0, -1) : phrase);
  if (!p) return false;
  const t = ` ${title} `;
  if (!prefix) return t.includes(` ${p} `);
  return t.includes(` ${p}`);
}

export function titleMatches(rawTitle: string, rules: TitleRules): boolean {
  // "Headphones + JBL earbuds", "... w/ stand", "... | Pro Stand Bundle": add-ons aren't the product.
  if (/\s\+\s?\S|\bw\/\s?\S|\bwith (?:stand|case|charger|earbuds|speaker)\b|\bpro stand\b/i.test(rawTitle)) return false;
  const title = normalizeText(rawTitle);
  if (!rules.any.some((p) => phraseMatches(title, p))) return false;
  if (rules.all?.some((group) => !group.some((p) => phraseMatches(title, p)))) return false;
  if ([...GLOBAL_EXCLUDE, ...(rules.none ?? [])].some((p) => phraseMatches(title, p))) return false;
  return true;
}

// ── Attribution to a tracked variant (pure) ──────────────────────────────────────────────

export type Attribution = { listings: NormalizedListing[]; matched: number; rejected: number; implausible: number; rejectedTitles: string[]; thumbnailUrl: string | null };

/** Prices below this fraction of the median matched price are treated as implausible (scam/mislisted). */
export const IMPLAUSIBLE_PRICE_FRACTION_BPS = 4000n;

function medianMinor(values: bigint[]): bigint | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2n;
}

/**
 * Keep results whose title passes the variant's rules and whose price is plausible relative to the
 * other matched results (at least 40% of the median, same currency); one listing per
 * (seller, condition), choosing the lowest item price (ties: earlier position).
 */
export function attributeOffers(tracked: TrackedVariant, offers: ShoppingOffer[], now: Date, sourceId = SERPAPI_SOURCE_ID): Attribution {
  const best = new Map<string, ShoppingOffer>();
  const titled = offers.filter((o) => titleMatches(o.title, tracked.rules));
  let implausible = 0;
  const accepted: ShoppingOffer[] = [];
  const medians = new Map<string, bigint | null>();
  for (const cur of ["CAD", "USD"] as const) medians.set(cur, medianMinor(titled.filter((o) => o.currency === cur).map((o) => o.priceMinor)));
  for (const o of titled) {
    const med = medians.get(o.currency) ?? null;
    // Product-specific floor (CAD): below it a "new" listing is a scam/mislisting; half for used.
    const floor = BigInt(tracked.priceFloorMinor) / (o.condition === "new" ? 1n : 2n);
    const belowFloor = o.currency === "CAD" && o.priceMinor < floor;
    const belowMedian = titled.filter((x) => x.currency === o.currency).length >= 3 && med !== null && o.priceMinor * 10000n < med * IMPLAUSIBLE_PRICE_FRACTION_BPS;
    if (belowFloor || belowMedian) {
      implausible++;
      continue;
    }
    accepted.push(o);
    const key = `${o.sellerSlug}|${o.condition}`;
    const prev = best.get(key);
    if (!prev || o.priceMinor < prev.priceMinor || (o.priceMinor === prev.priceMinor && o.position < prev.position)) best.set(key, o);
  }
  const matched = titled.length;
  const listings = [...best.values()].map((o) =>
    validateListing({
      sourceId,
      sourceMode: "live",
      market: "CA",
      externalListingId: `${tracked.variantId}:${o.sellerSlug}:${o.condition}`.slice(0, 256),
      externalVariantKey: "",
      sellerKey: o.sellerSlug,
      sellerName: o.sellerName,
      platform: o.platform,
      title: o.title,
      // Identity was established by the variant's title rules, so the listing carries the
      // variant's brand, model and critical attributes for the deterministic matcher.
      brand: tracked.brand,
      model: tracked.modelCode,
      identifiers: [],
      attributes: tracked.attributes,
      condition: o.condition,
      stock: o.stock,
      itemPrice: money(o.priceMinor, o.currency),
      shipping: o.shipping,
      mandatoryFees: money(0n, o.currency),
      feeStatus: "complete",
      outboundUrl: o.outboundUrl,
      imageUrl: null,
      sourceObservedAt: null,
      fetchedAt: now.toISOString(),
      validUntil: null,
      sourceRecordVersion: o.productId,
      restrictions: [],
      categoryHint: tracked.category,
    }),
  );
  // Representative picture: earliest-positioned accepted (title + plausible price) offer with a
  // thumbnail, preferring new condition.
  const pic = accepted.filter((o) => o.thumbnailUrl).sort((a, b) => (a.condition === "new" ? 0 : 1) - (b.condition === "new" ? 0 : 1) || a.position - b.position)[0];
  return { listings, thumbnailUrl: pic?.thumbnailUrl ?? null, matched, rejected: offers.length - matched, implausible, rejectedTitles: offers.filter((o) => !titled.includes(o)).slice(0, 15).map((o) => o.title.slice(0, 100)) };
}

// ── HTTP connector ───────────────────────────────────────────────────────────────────────

export type SerpApiOptions = {
  apiKey: string;
  clock: Clock;
  location?: string;
  sourceId?: string;
  fetchImpl?: typeof fetch;
};

export class SerpApiShoppingProvider implements CatalogProvider {
  readonly mode = "live" as const;
  readonly sourceId: string;
  constructor(private readonly opts: SerpApiOptions) {
    if (!opts.apiKey) throw new Error("SerpApi key missing");
    this.sourceId = opts.sourceId ?? SERPAPI_SOURCE_ID;
  }

  capabilities(): SourceCapabilities {
    return SERPAPI_CAPS;
  }

  /** One SerpApi search (one credit). Throws typed ProviderErrors; never includes the key. */
  async fetchShopping(query: string, signal?: AbortSignal): Promise<ParsedResponse> {
    const q = query.trim().slice(0, 200);
    if (!q) throw new ProviderError("permanent_failure", "Empty query");
    const params = new URLSearchParams({
      engine: "google_shopping",
      q,
      google_domain: "google.ca",
      gl: "ca",
      hl: "en",
      location: this.opts.location ?? "Toronto, Ontario, Canada",
      api_key: this.opts.apiKey,
    });
    let res: Response;
    try {
      res = await (this.opts.fetchImpl ?? fetch)(`${ENDPOINT}?${params}`, { signal, headers: { accept: "application/json" } });
    } catch (e) {
      if ((e as Error)?.name === "AbortError" || signal?.aborted) throw new ProviderError("timeout", "SerpApi request aborted");
      throw new ProviderError("temporarily_unavailable", "SerpApi network error");
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new ProviderError("invalid_response", "SerpApi response too large");
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (res.ok) throw new ProviderError("invalid_response", "SerpApi returned non-JSON");
    }
    const err = str(body.error);
    if (res.status === 401 || res.status === 403 || (err && /invalid api key/i.test(err))) throw new ProviderError("invalid_credentials", "SerpApi rejected the API key");
    if (res.status === 429 || (err && /run out of searches|plan limit|rate limit|hourly/i.test(err))) {
      throw new ProviderError("quota_exhausted", "SerpApi quota or rate limit reached", 24 * 3600_000);
    }
    if (err && /hasn.t returned any results|no results/i.test(err)) return { offers: [], skipped: 0, total: 0 };
    if (res.status >= 500) throw new ProviderError("temporarily_unavailable", `SerpApi HTTP ${res.status}`);
    if (!res.ok || err) throw new ProviderError("permanent_failure", `SerpApi error (HTTP ${res.status})${err ? `: ${err.slice(0, 120)}` : ""}`);
    const status = str((body.search_metadata as Record<string, unknown> | undefined)?.status);
    if (status && status !== "Success") throw new ProviderError("temporarily_unavailable", `SerpApi search status ${status.slice(0, 40)}`);
    return parseShoppingResponse(body, q);
  }

  /** Sweep one tracked variant: one search, attributed by the variant's title rules. */
  async sweep(tracked: TrackedVariant, signal?: AbortSignal): Promise<Attribution & { total: number; skipped: number }> {
    const parsed = await this.fetchShopping(tracked.query, signal);
    const a = attributeOffers(tracked, parsed.offers, this.opts.clock.now(), this.sourceId);
    return { ...a, total: parsed.total, skipped: parsed.skipped };
  }

  /** Contract search: raw results, not attributed to a variant (brand/model unknown). */
  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchResult> {
    const parsed = await this.fetchShopping(input.query, signal);
    const now = this.opts.clock.now().toISOString();
    const items = parsed.offers.slice(0, Math.max(1, input.limit)).map((o) =>
      validateListing({
        sourceId: this.sourceId,
        sourceMode: "live",
        market: "CA",
        externalListingId: `${o.productId ?? o.position}:${o.sellerSlug}:${o.condition}`.slice(0, 256),
        externalVariantKey: "",
        sellerKey: o.sellerSlug,
        sellerName: o.sellerName,
        platform: o.platform,
        title: o.title,
        brand: null,
        model: null,
        identifiers: [],
        attributes: {},
        condition: o.condition,
        stock: o.stock,
        itemPrice: money(o.priceMinor, o.currency),
        shipping: o.shipping,
        mandatoryFees: money(0n, o.currency),
        feeStatus: "complete",
        outboundUrl: o.outboundUrl,
        imageUrl: null,
        sourceObservedAt: null,
        fetchedAt: now,
        validUntil: null,
        sourceRecordVersion: o.productId,
        restrictions: [],
        categoryHint: null,
      }),
    );
    return { items };
  }

  async lookup(_input: LookupInput): Promise<NormalizedListing> {
    throw new ProviderError("unsupported_operation", "SerpApi listings are refreshed by variant sweeps, not per-listing lookups");
  }
}
