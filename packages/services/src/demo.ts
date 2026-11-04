/**
 * Demonstration catalog seeding and scripted price changes. Rerunnable and scoped to demo
 * records only (never truncates). Ingestion goes through the real provider contract,
 * matching and observation pipeline.
 */
import { withTx, type Db } from "@buytrail/db";
import { normalizeGtin, normalizeModel, sha256, type Clock } from "@buytrail/domain";
import {
  DEMO_CONTEXT_ID,
  DEMO_LISTINGS,
  DEMO_MERCHANTS,
  DEMO_PRODUCTS,
  DEMO_SOURCE_A,
  DEMO_SOURCE_B,
  DemoProvider,
  type CatalogProvider,
  type SourceCapabilities,
} from "@buytrail/providers";
import { claimRefresh, acceptObservation, refreshListing, upsertListingFromSource } from "./ingestion";

export const DEMO_CAPS: SourceCapabilities = {
  search: true,
  lookup: true,
  shippingQuotes: true,
  historyAllowed: true,
  imageDisplayAllowed: false,
  maxBatchSize: 50,
  minimumRefreshSeconds: 60,
};

export const DEMO_FRESHNESS_SECONDS = 6 * 3600;

export function demoProviders(clock: Clock, db: Db): Map<string, CatalogProvider> {
  const priceOverride = async (externalListingId: string) => {
    const o = await db.demoPriceOverride.findUnique({ where: { externalListingId } });
    return o?.itemPriceMinor ?? null;
  };
  return new Map<string, CatalogProvider>([
    [DEMO_SOURCE_A, new DemoProvider({ sourceId: DEMO_SOURCE_A, clock, priceOverride })],
    [DEMO_SOURCE_B, new DemoProvider({ sourceId: DEMO_SOURCE_B, clock, priceOverride })],
  ]);
}

/** Upsert demo sources, merchants, catalog, context. Safe to rerun. */
export async function seedDemoCatalog(db: Db): Promise<{ products: number; variants: number }> {
  await withTx(db, async (tx) => {
    for (const [id, name] of [
      [DEMO_SOURCE_A, "Demo retail feed (sample data)"],
      [DEMO_SOURCE_B, "Demo marketplace feed (sample data)"],
    ] as const) {
      const hosts = DEMO_MERCHANTS.filter((m) => m.sourceId === id).map((m) => m.host);
      await tx.source.upsert({
        where: { id },
        create: { id, name, mode: "demo", approvalStatus: "demo", capabilities: DEMO_CAPS, allowedHosts: hosts, freshnessSeconds: DEMO_FRESHNESS_SECONDS, historyRetentionDays: 180, dailyRequestBudget: 20000, concurrency: 4 },
        update: { name, mode: "demo", capabilities: DEMO_CAPS, allowedHosts: hosts, freshnessSeconds: DEMO_FRESHNESS_SECONDS, historyRetentionDays: 180 },
      });
    }
    for (const m of DEMO_MERCHANTS) {
      await tx.merchant.upsert({ where: { id: m.id }, create: { id: m.id, name: m.name, platform: m.platform, displayUrl: `https://${m.host}/`, isDemo: true }, update: { name: m.name, platform: m.platform } });
    }
    await tx.quoteContext.upsert({
      where: { id: DEMO_CONTEXT_ID },
      create: { id: DEMO_CONTEXT_ID, market: "CA", quantity: 1, destinationScope: "national", description: "Canada, national shipping, quantity 1" },
      update: {},
    });
    for (const p of DEMO_PRODUCTS) {
      await tx.product.upsert({
        where: { id: p.id },
        create: { id: p.id, title: p.title, brand: p.brand, category: p.category, family: p.family, description: p.description, isDemo: true },
        update: { title: p.title, brand: p.brand, category: p.category, family: p.family, description: p.description, isDemo: true },
      });
      for (const v of p.variants) {
        const mc = normalizeModel(v.modelCode)!;
        await tx.productVariant.upsert({
          where: { id: v.id },
          create: { id: v.id, productId: p.id, modelCode: v.modelCode, modelCodeNormalized: mc, label: v.label, attributes: v.attributes, isDemo: true },
          update: { modelCode: v.modelCode, modelCodeNormalized: mc, label: v.label, attributes: v.attributes },
        });
        const g = normalizeGtin(v.gtin);
        if (!g.ok) throw new Error(`Demo GTIN invalid for ${v.id}`);
        await tx.productIdentifier.upsert({
          where: { kind_normalized_variantId: { kind: "gtin", normalized: g.normalized, variantId: v.id } },
          create: { variantId: v.id, kind: "gtin", original: v.gtin, normalized: g.normalized, provenance: "demo-seed" },
          update: {},
        });
      }
    }
  });
  return { products: DEMO_PRODUCTS.length, variants: DEMO_PRODUCTS.reduce((n, p) => n + p.variants.length, 0) };
}

/**
 * Seed demo price history: for each listing, ingest one observation per day for `days` days
 * ending at the clock's now, using deterministic price jitter. Runs through the real pipeline
 * with an explicitly back-dated clock, so provenance timestamps are honest about the
 * simulated time (all of it labelled demo).
 */
export async function seedDemoListings(db: Db, clock: Clock, opts: { historyDays?: number } = {}) {
  const days = opts.historyDays ?? 21;
  const now = clock.now();
  let ingested = 0;
  for (let d = days; d >= 0; d--) {
    const at = new Date(now.getTime() - d * 86400_000);
    const dayClock: Clock = { now: () => at };
    const providers = demoProviders(dayClock, db);
    for (const l of DEMO_LISTINGS) {
      // Skip history for some listings to create honest gaps.
      if (d > 0 && d % 5 === 0 && l.externalListingId.endsWith("1")) continue;
      // History starts later for the stale/threshold edge-case listings (G25: short coverage).
      if (d > 8 && ["MA-240", "SP-250"].includes(l.externalListingId)) continue;
      const provider = providers.get(l.sourceId)!;
      const n = await provider.lookup({ externalListingId: l.externalListingId, externalVariantKey: "", sellerKey: l.merchantId, contextKey: "ca-national" });
      if (d > 0 && n.itemPrice) {
        const jitter = BigInt(((Number(sha256(`${l.externalListingId}:${d}`).slice(0, 4)) || 0) % 9) - 3) * 100n;
        const base = BigInt(n.itemPrice.amountMinor);
        const p = base + jitter + BigInt(Math.floor(d / 7)) * 500n;
        n.itemPrice = { ...n.itemPrice, amountMinor: (p > 100n ? p : base).toString() };
      }
      const listingId = await upsertListingFromSource(db, n, l.merchantId, true);
      const claim = await claimRefresh(db, dayClock, listingId, DEMO_CONTEXT_ID, `seed:${d}`);
      if (!claim) continue;
      // Run id + record key make this idempotent across reruns for the same day.
      await acceptObservation(db, dayClock, { ...claim, runId: claim.runId }, n);
      ingested++;
    }
  }
  return { ingested };
}

/** Is the catalog already seeded with current quotes? */
export async function demoSeedState(db: Db) {
  const [products, quotes, listings] = await Promise.all([db.product.count({ where: { isDemo: true } }), db.offerQuote.count(), db.sourceListing.count({ where: { isDemo: true } })]);
  return { products, quotes, listings };
}

/** Refresh every demo listing now (used by the worker's demo ticker and "refresh" tooling). */
export async function refreshAllDemo(db: Db, clock: Clock) {
  const providers = demoProviders(clock, db);
  const listings = await db.sourceListing.findMany({ where: { isDemo: true }, select: { id: true } });
  const out: Record<string, number> = {};
  for (const l of listings) {
    const r = await refreshListing(db, clock, providers, l.id, DEMO_CONTEXT_ID);
    const k = r.kind === "accepted" ? (r.result.applied ? "applied" : "superseded") : `${r.kind}:${"reason" in r ? r.reason : r.code}`;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/**
 * Demonstration-only: script a price for a demo listing and refresh it through the normal
 * pipeline. Refuses non-demo listings.
 */
export async function simulateDemoPrice(db: Db, clock: Clock, externalListingId: string, itemPriceMinor: bigint | null) {
  const listing = await db.sourceListing.findFirst({ where: { externalListingId, isDemo: true, source: { mode: "demo" } } });
  if (!listing) throw new Error("Not a demo listing");
  if (itemPriceMinor === null) await db.demoPriceOverride.deleteMany({ where: { externalListingId } });
  else await db.demoPriceOverride.upsert({ where: { externalListingId }, create: { externalListingId, itemPriceMinor }, update: { itemPriceMinor, setAt: clock.now() } });
  return refreshListing(db, clock, demoProviders(clock, db), listing.id, DEMO_CONTEXT_ID);
}

export const SAMPLE_RECEIPT_IDS = ["sample-receipt-png", "sample-receipt-pdf"] as const;
