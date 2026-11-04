/**
 * Deterministic demonstration provider. Implements the same CatalogProvider contract as a real
 * connector so ingestion, matching, freshness and alerting are exercised end-to-end, while every
 * record it emits is labelled sourceMode "demo".
 */
import type { Clock } from "@buytrail/domain";
import {
  CatalogProvider,
  LookupInput,
  NormalizedListing,
  ProviderError,
  SearchInput,
  SearchResult,
  SourceCapabilities,
  validateListing,
} from "./contract";
import { DEMO_CONTEXT_KEY, DEMO_LISTINGS, DEMO_MERCHANTS, DemoListing, demoListingFields } from "./demo-catalog";

export type DemoFault =
  | { kind: "timeout"; delayMs: number }
  | { kind: "rate_limited"; retryAfterMs: number }
  | { kind: "malformed" }
  | { kind: "removed" };

export type DemoProviderOptions = {
  sourceId: string;
  clock: Clock;
  /** Scripted price overrides (demo-only "simulate a price change"). */
  priceOverride?: (externalListingId: string) => Promise<bigint | null> | bigint | null;
  /** Fault injection for tests and failure demonstrations. */
  fault?: (externalListingId: string) => DemoFault | null;
};

const CAPS: SourceCapabilities = {
  search: true,
  lookup: true,
  shippingQuotes: true,
  historyAllowed: true,
  imageDisplayAllowed: false,
  maxBatchSize: 50,
  minimumRefreshSeconds: 60,
};

export class DemoProvider implements CatalogProvider {
  readonly mode = "demo" as const;
  readonly sourceId: string;
  constructor(private readonly opts: DemoProviderOptions) {
    this.sourceId = opts.sourceId;
  }

  capabilities(): SourceCapabilities {
    return CAPS;
  }

  private listings(): DemoListing[] {
    return DEMO_LISTINGS.filter((l) => l.sourceId === this.sourceId);
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const limit = Math.min(Math.max(1, input.limit), CAPS.maxBatchSize);
    const offset = input.cursor ? Number.parseInt(input.cursor, 10) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new ProviderError("permanent_failure", "Invalid cursor");
    const q = input.query.trim().toLowerCase();
    const all = this.listings().filter((l) => !q || demoListingFields(l).title.toLowerCase().includes(q));
    const page = all.slice(offset, offset + limit);
    const items = await Promise.all(page.map((l) => this.toNormalized(l)));
    return { items, nextCursor: offset + limit < all.length ? String(offset + limit) : undefined };
  }

  async lookup(input: LookupInput, signal?: AbortSignal): Promise<NormalizedListing> {
    if (input.contextKey !== DEMO_CONTEXT_KEY) throw new ProviderError("unsupported_context", "Demo source only quotes national CA context");
    const l = this.listings().find((x) => x.externalListingId === input.externalListingId);
    if (!l) throw new ProviderError("removed_listing", "Listing not found");
    const fault = this.opts.fault?.(l.externalListingId) ?? null;
    if (fault) {
      if (fault.kind === "rate_limited") throw new ProviderError("quota_exhausted", "Demo 429", fault.retryAfterMs);
      if (fault.kind === "removed") throw new ProviderError("removed_listing", "Listing removed");
      if (fault.kind === "timeout") {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, fault.delayMs);
          signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new ProviderError("timeout", "aborted"));
          });
        });
      }
      if (fault.kind === "malformed") return validateListing({ ...(await this.toNormalized(l)), itemPrice: { amountMinor: "-5", currency: "CAD" } });
    }
    return this.toNormalized(l);
  }

  private async toNormalized(l: DemoListing): Promise<NormalizedListing> {
    const now = this.opts.clock.now();
    const merchant = DEMO_MERCHANTS.find((m) => m.id === l.merchantId)!;
    const f = demoListingFields(l);
    const currency = l.currency ?? "CAD";
    const override = l.priceMinor !== null ? await this.opts.priceOverride?.(l.externalListingId) : null;
    const price = override ?? (l.priceMinor !== null ? BigInt(l.priceMinor) : null);
    const m = (minor: number | bigint) => ({ amountMinor: String(minor), currency });
    const shipping =
      l.shipping.kind === "known"
        ? { kind: "known" as const, amount: m(l.shipping.minor), contextKey: DEMO_CONTEXT_KEY }
        : l.shipping.kind === "unknown"
          ? { kind: "unknown" as const, reason: l.shipping.reason }
          : {
              kind: "threshold" as const,
              freeAtOrAbove: m(l.shipping.freeAtOrAboveMinor),
              belowAmount: l.shipping.belowMinor === null ? null : m(l.shipping.belowMinor),
              contextKey: DEMO_CONTEXT_KEY,
            };
    const observed = new Date(now.getTime() - (l.observedLagMinutes ?? 5) * 60_000);
    return validateListing({
      sourceId: this.sourceId,
      sourceMode: "demo",
      market: "CA",
      externalListingId: l.externalListingId,
      externalVariantKey: "",
      sellerKey: merchant.id,
      sellerName: merchant.name,
      platform: merchant.platform,
      title: f.title,
      brand: f.brand,
      model: f.model,
      identifiers: f.identifiers,
      attributes: f.attributes,
      condition: l.condition ?? "new",
      stock: l.stock ?? "in_stock",
      itemPrice: price === null ? null : m(price),
      shipping,
      mandatoryFees: l.feesMinor == null ? m(0) : m(l.feesMinor),
      feeStatus: "complete",
      outboundUrl: `https://${merchant.host}/p/${encodeURIComponent(l.externalListingId)}`,
      imageUrl: null,
      sourceObservedAt: observed.toISOString(),
      fetchedAt: now.toISOString(),
      validUntil: null,
      sourceRecordVersion: null,
      restrictions: l.restrictions ?? [],
      categoryHint: f.categoryHint,
    });
  }
}
