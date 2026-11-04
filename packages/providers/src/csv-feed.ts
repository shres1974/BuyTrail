/**
 * Authorized retailer CSV feed parser (Section 9 option 1; Section 10 import rules).
 * Parses CSV strictly as data: bounded size and rows, exact header set, no formula evaluation.
 * Produces NormalizedListing records; it never fetches URLs.
 */
import { parseMajor } from "@buytrail/domain";
import { NormalizedListing, ProviderError, validateListing } from "./contract";

export const FEED_COLUMNS = [
  "external_listing_id",
  "seller_key",
  "seller_name",
  "title",
  "brand",
  "model",
  "gtin",
  "condition",
  "stock",
  "currency",
  "item_price",
  "shipping_status",
  "shipping_price",
  "fees",
  "outbound_url",
  "observed_at",
  "attributes",
] as const;

export type FeedLimits = { maxBytes: number; maxRows: number };
export const DEFAULT_FEED_LIMITS: FeedLimits = { maxBytes: 2 * 1024 * 1024, maxRows: 5000 };

export type FeedRowError = { row: number; message: string };
export type FeedParseResult = { listings: NormalizedListing[]; errors: FeedRowError[] };

/** RFC 4180-style parser: quoted fields, doubled quotes, CRLF/LF. No type coercion. */
export function parseCsv(text: string, maxRows: number): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      if (rows.length > maxRows + 1) throw new ProviderError("permanent_failure", `Feed exceeds ${maxRows} rows`);
    } else field += c;
  }
  if (inQuotes) throw new ProviderError("invalid_response", "Unterminated quoted field");
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  if (rows.length > maxRows + 1) throw new ProviderError("permanent_failure", `Feed exceeds ${maxRows} rows`);
  return rows;
}

const toMinor = (s: string): string => parseMajor(s).toString();

export function parseFeed(
  text: string,
  meta: { sourceId: string; sourceMode: "sandbox" | "live" | "demo"; fetchedAt: Date; allowedHosts: string[] },
  limits: FeedLimits = DEFAULT_FEED_LIMITS,
): FeedParseResult {
  if (Buffer.byteLength(text, "utf8") > limits.maxBytes) throw new ProviderError("permanent_failure", `Feed exceeds ${limits.maxBytes} bytes`);
  const rows = parseCsv(text.replace(/^\uFEFF/, ""), limits.maxRows);
  const header = rows.shift();
  if (!header) throw new ProviderError("invalid_response", "Empty feed");
  const h = header.map((x) => x.trim());
  const missing = FEED_COLUMNS.filter((c) => !h.includes(c));
  const unexpected = h.filter((c) => !(FEED_COLUMNS as readonly string[]).includes(c));
  if (missing.length || unexpected.length) {
    throw new ProviderError("invalid_response", `Header mismatch. Missing: [${missing.join(", ")}] Unexpected: [${unexpected.join(", ")}]`);
  }
  const idx = Object.fromEntries(h.map((c, i) => [c, i])) as Record<(typeof FEED_COLUMNS)[number], number>;
  const listings: NormalizedListing[] = [];
  const errors: FeedRowError[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const rowNo = i + 2;
    try {
      if (r.length !== h.length) throw new Error(`Expected ${h.length} fields, got ${r.length}`);
      const get = (k: (typeof FEED_COLUMNS)[number]) => (r[idx[k]] ?? "").trim();
      const key = `${get("external_listing_id")}|${get("seller_key")}`;
      if (seen.has(key)) throw new Error("Duplicate listing in feed");
      seen.add(key);
      const currency = get("currency");
      if (currency !== "CAD" && currency !== "USD") throw new Error("Unsupported currency");
      const url = get("outbound_url");
      const host = (() => {
        try {
          return new URL(url).hostname.toLowerCase();
        } catch {
          return "";
        }
      })();
      if (!url.startsWith("https://") || !meta.allowedHosts.includes(host)) throw new Error("Outbound URL host is not allowed for this source");
      const shippingStatus = get("shipping_status");
      const shipping =
        shippingStatus === "known"
          ? { kind: "known" as const, amount: { amountMinor: toMinor(get("shipping_price")), currency }, contextKey: "ca-national" }
          : shippingStatus === "unknown"
            ? { kind: "unknown" as const, reason: "Feed did not state shipping" }
            : (() => {
                throw new Error("shipping_status must be known or unknown");
              })();
      const fees = get("fees");
      const attrsRaw = get("attributes");
      const attributes: Record<string, string> = {};
      if (attrsRaw) {
        for (const pair of attrsRaw.split(";")) {
          const [k, ...rest] = pair.split("=");
          if (!k || rest.length === 0) throw new Error("attributes must be key=value;key=value");
          attributes[k.trim()] = rest.join("=").trim();
        }
      }
      const observed = get("observed_at");
      const price = get("item_price");
      listings.push(
        validateListing({
          sourceId: meta.sourceId,
          sourceMode: meta.sourceMode,
          market: "CA",
          externalListingId: get("external_listing_id"),
          externalVariantKey: "",
          sellerKey: get("seller_key"),
          sellerName: get("seller_name"),
          platform: null,
          title: get("title"),
          brand: get("brand") || null,
          model: get("model") || null,
          identifiers: get("gtin") ? [{ kind: "gtin", value: get("gtin") }] : [],
          attributes,
          condition: get("condition") || "unknown",
          stock: get("stock") || "unknown",
          itemPrice: price ? { amountMinor: toMinor(price), currency } : null,
          shipping,
          mandatoryFees: fees ? { amountMinor: toMinor(fees), currency } : null,
          feeStatus: fees ? "complete" : "unknown",
          outboundUrl: url,
          imageUrl: null,
          sourceObservedAt: observed ? new Date(observed).toISOString() : null,
          fetchedAt: meta.fetchedAt.toISOString(),
          validUntil: null,
          sourceRecordVersion: null,
          restrictions: [],
          categoryHint: null,
        }),
      );
    } catch (e) {
      errors.push({ row: rowNo, message: e instanceof Error ? e.message : String(e) });
    }
  });
  return { listings, errors };
}
