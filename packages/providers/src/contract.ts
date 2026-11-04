/**
 * Internal provider connector contract (Section 10). This is BuyTrail's design contract,
 * not a copy of any retailer API. Source-specific details stay inside each adapter.
 */
import { z } from "zod";

export type SourceMode = "demo" | "sandbox" | "live";

export type SourceCapabilities = {
  search: boolean;
  lookup: boolean;
  shippingQuotes: boolean;
  historyAllowed: boolean;
  imageDisplayAllowed: boolean;
  maxBatchSize: number;
  minimumRefreshSeconds: number;
};

export const sourceCapabilitiesSchema = z.object({
  search: z.boolean(),
  lookup: z.boolean(),
  shippingQuotes: z.boolean(),
  historyAllowed: z.boolean(),
  imageDisplayAllowed: z.boolean(),
  maxBatchSize: z.number().int().min(1),
  minimumRefreshSeconds: z.number().int().min(0),
});

const minor = z.string().regex(/^(0|[1-9][0-9]{0,15})$/, "minor units must be a non-negative decimal integer string");
const currency = z.enum(["CAD", "USD"]);
export const moneySchema = z.object({ amountMinor: minor, currency });
export type ProviderMoney = z.infer<typeof moneySchema>;

export const shippingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("known"), amount: moneySchema, contextKey: z.string() }),
  z.object({ kind: z.literal("unknown"), reason: z.string() }),
  /** Free shipping at/above a basket threshold; below it, a known fee or unknown. */
  z.object({ kind: z.literal("threshold"), freeAtOrAbove: moneySchema, belowAmount: moneySchema.nullable(), contextKey: z.string() }),
]);

export const restrictionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("membership"), program: z.string() }),
  z.object({ kind: z.literal("coupon"), code: z.string().optional() }),
  z.object({ kind: z.literal("subscription") }),
  z.object({ kind: z.literal("trade_in") }),
]);

const isoDate = z.string().datetime({ offset: true });

export const normalizedListingSchema = z.object({
  sourceId: z.string().min(1),
  sourceMode: z.enum(["demo", "sandbox", "live"]),
  market: z.literal("CA"),
  externalListingId: z.string().min(1).max(256),
  externalVariantKey: z.string().max(256),
  sellerKey: z.string().min(1).max(256),
  sellerName: z.string().min(1).max(200),
  platform: z.string().max(200).nullable(),
  title: z.string().min(1).max(500),
  brand: z.string().max(200).nullable(),
  model: z.string().max(200).nullable(),
  identifiers: z.array(z.object({ kind: z.enum(["gtin", "mpn"]), value: z.string().max(64) })).max(20),
  attributes: z.record(z.string(), z.string().max(200)),
  condition: z.enum(["new", "refurbished", "used", "unknown"]),
  stock: z.enum(["in_stock", "out_of_stock", "unknown"]),
  itemPrice: moneySchema.nullable(),
  shipping: shippingSchema,
  mandatoryFees: moneySchema.nullable(),
  feeStatus: z.enum(["complete", "unknown"]),
  outboundUrl: z.string().url().max(2048),
  imageUrl: z.string().url().max(2048).nullable(),
  sourceObservedAt: isoDate.nullable(),
  fetchedAt: isoDate,
  validUntil: isoDate.nullable(),
  sourceRecordVersion: z.string().max(128).nullable(),
  restrictions: z.array(restrictionSchema),
  /** Category hint for matching; the canonical variant decides the real category. */
  categoryHint: z.enum(["headphones", "monitors", "small_appliances"]).nullable(),
});

export type NormalizedListing = z.infer<typeof normalizedListingSchema>;

export type ProviderErrorCode =
  | "invalid_credentials"
  | "permission_denied"
  | "quota_exhausted"
  | "temporarily_unavailable"
  | "invalid_response"
  | "unsupported_context"
  | "removed_listing"
  | "permanent_failure"
  | "unsupported_operation"
  | "timeout";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "ProviderError";
  }
  get retryable(): boolean {
    return this.code === "temporarily_unavailable" || this.code === "quota_exhausted" || this.code === "timeout";
  }
}

export type SearchInput = { query: string; cursor?: string; limit: number };
export type SearchResult = { items: NormalizedListing[]; nextCursor?: string };
export type LookupInput = { externalListingId: string; externalVariantKey: string; sellerKey: string; contextKey: string };

export interface CatalogProvider {
  readonly sourceId: string;
  readonly mode: SourceMode;
  capabilities(): SourceCapabilities;
  /** Throws ProviderError("unsupported_operation") when capabilities().search is false. */
  search(input: SearchInput, signal?: AbortSignal): Promise<SearchResult>;
  lookup(input: LookupInput, signal?: AbortSignal): Promise<NormalizedListing>;
}

/** Validate untrusted provider output; never trust adapter output shape blindly. */
export function validateListing(raw: unknown): NormalizedListing {
  const r = normalizedListingSchema.safeParse(raw);
  if (!r.success) {
    throw new ProviderError("invalid_response", `Listing failed validation: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  return r.data;
}

/** Run a provider call with a hard timeout; a timeout is a check failure, never a business state. */
export async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ac = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(new ProviderError("timeout", `Provider call exceeded ${ms} ms`));
    }, ms);
  });
  try {
    return await Promise.race([fn(ac.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
