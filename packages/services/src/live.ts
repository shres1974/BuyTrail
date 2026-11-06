/**
 * Live prices for the curated catalog via SerpApi Google Shopping (mixed demonstration).
 *
 * Each tracked variant is re-searched on its own schedule (one credit per search). Every SerpApi
 * call first passes a rolling 30-day cap and the source's atomic daily budget, so a bug or a
 * restart loop cannot drain the plan. Watches, alerts and pre-send revalidation use stored
 * quotes only; they never trigger a search.
 */
import { withTx, type Db } from "@buytrail/db";
import { normalizeModel, type Clock } from "@buytrail/domain";
import {
  LIVE_VARIANTS,
  ProviderError,
  SERPAPI_ALLOWED_HOSTS,
  SERPAPI_CAPS,
  SERPAPI_SOURCE_ID,
  SerpApiShoppingProvider,
  withTimeout,
  type NormalizedListing,
  type TrackedVariant,
} from "@buytrail/providers";
import type { AppConfig } from "@buytrail/config";
import { acceptObservation, bumpVariantGeneration, claimRefresh, upsertListingFromSource } from "./ingestion";
import { PUBLIC_CONTEXT_ID } from "./catalog";
import { recordSourceFailure, recordSourceSuccess, reserveSourceRequest } from "./sources";
import type { Logger } from "./context";
import { storeLiveProductImage } from "./images";
import type { ObjectStore } from "./storage";

export const LIVE_SOURCE_NAME = "Google Shopping via SerpApi (live prices)";
export const SWEEP_TIMEOUT_MS = 30_000;
const ROLLING_WINDOW_DAYS = 30;
const RETRY_AFTER_FAILURE_MS = 6 * 3600_000;

export function liveProvider(config: AppConfig, clock: Clock): SerpApiShoppingProvider | null {
  if (!config.LIVE_PROVIDERS_ENABLED || !config.SERPAPI_API_KEY) return null;
  return new SerpApiShoppingProvider({ apiKey: config.SERPAPI_API_KEY, clock });
}

/** Freshness: one refresh interval plus a day of grace before a live price counts as stale. */
export const liveFreshnessSeconds = (config: AppConfig) => (config.SERPAPI_REFRESH_HOURS + 24) * 3600;

/** Upsert the live source, curated products/variants and their sweep schedules. No API calls. */
export async function seedLiveCatalog(db: Db, config: AppConfig, now: Date): Promise<{ products: number }> {
  await withTx(db, async (tx) => {
    const sourceData = {
      name: LIVE_SOURCE_NAME,
      mode: "live",
      // Owner-approved for this demonstration; see docs/source-capabilities.md.
      approvalStatus: "approved",
      capabilities: SERPAPI_CAPS,
      allowedHosts: SERPAPI_ALLOWED_HOSTS,
      freshnessSeconds: liveFreshnessSeconds(config),
      historyRetentionDays: 180,
      dailyRequestBudget: config.SERPAPI_DAILY_BUDGET,
      concurrency: 1,
    };
    await tx.source.upsert({ where: { id: SERPAPI_SOURCE_ID }, create: { id: SERPAPI_SOURCE_ID, ...sourceData }, update: sourceData });
    for (const v of LIVE_VARIANTS) {
      const product = { title: v.title, brand: v.brand, category: v.category, family: v.family, description: v.description, isDemo: false };
      await tx.product.upsert({ where: { id: v.productId }, create: { id: v.productId, ...product }, update: product });
      const variant = { modelCode: v.modelCode, modelCodeNormalized: normalizeModel(v.modelCode)!, label: v.label, attributes: v.attributes, isDemo: false };
      await tx.productVariant.upsert({ where: { id: v.variantId }, create: { id: v.variantId, productId: v.productId, ...variant }, update: variant });
      await tx.liveSweep.upsert({ where: { variantId: v.variantId }, create: { variantId: v.variantId, sourceId: SERPAPI_SOURCE_ID, nextDueAt: now }, update: {} });
    }
  });
  return { products: LIVE_VARIANTS.length };
}

/** Searches used in the rolling window (all days counted by the source budget table). */
export async function liveSearchesUsed(db: Db, now: Date, days = ROLLING_WINDOW_DAYS): Promise<number> {
  const since = new Date(now.getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10);
  const r = await db.sourceBudgetDay.aggregate({ where: { sourceId: SERPAPI_SOURCE_ID, day: { gte: since } }, _sum: { used: true } });
  return r._sum.used ?? 0;
}

export type SweepOutcome =
  | { variantId: string; kind: "swept"; listings: number; applied: number; matched: number; rejected: number; implausible: number; image: boolean; rejectedTitles?: string[] }
  | { variantId: string; kind: "failed"; code: string }
  | { variantId: string; kind: "skipped"; reason: "monthly_budget_exhausted" | "daily_budget_exhausted" | "rate_limited" | "circuit_open" | "disabled" };

/** Persist one variant's sweep result through the normal claim → accept pipeline. */
async function ingestSweep(db: Db, clock: Clock, variantId: string, listings: NormalizedListing[]): Promise<number> {
  let applied = 0;
  const seen = new Set<string>();
  for (const n of listings) {
    const merchantId = `m_live_${n.sellerKey}`.slice(0, 160);
    await db.merchant.upsert({
      where: { id: merchantId },
      create: { id: merchantId, name: n.sellerName, platform: n.platform, isDemo: false },
      update: { name: n.sellerName, platform: n.platform },
    });
    const listingId = await upsertListingFromSource(db, n, merchantId, false);
    seen.add(listingId);
    const claim = await claimRefresh(db, clock, listingId, PUBLIC_CONTEXT_ID, "import");
    if (!claim) continue;
    // A new independent search re-checks a price that was held for anomaly verification.
    const existing = await db.offerQuote.findUnique({ where: { listingId_contextId: { listingId, contextId: PUBLIC_CONTEXT_ID } }, select: { anomalyStatus: true } });
    const r = await acceptObservation(db, clock, claim, n, { verification: existing?.anomalyStatus === "pending_verification" });
    if (r.applied) applied++;
  }
  // A seller missing from the latest search (or now filtered out) is no longer offered for this
  // variant; withdraw it. It reappears automatically if a later search returns it again. An empty
  // result is treated as inconclusive, so a transient blank search never wipes every offer.
  if (!listings.length) return applied;
  const now = clock.now();
  await withTx(db, async (tx) => {
    const gone = await tx.sourceListing.findMany({
      where: { sourceId: SERPAPI_SOURCE_ID, externalListingId: { startsWith: `${variantId}:` }, removedAt: null, id: { notIn: [...seen] } },
      select: { id: true },
    });
    if (!gone.length) return;
    await tx.sourceListing.updateMany({ where: { id: { in: gone.map((g) => g.id) } }, data: { removedAt: now } });
    await bumpVariantGeneration(tx, variantId, PUBLIC_CONTEXT_ID, `live-withdrawn:${now.getTime()}`, now);
  });
  return applied;
}

/** Sweep one tracked variant now, subject to both budgets. */
export async function sweepLiveVariant(
  db: Db,
  clock: Clock,
  config: AppConfig,
  provider: SerpApiShoppingProvider,
  tracked: TrackedVariant,
  opts: { ignoreDailyCap?: boolean; debug?: boolean; storage?: ObjectStore; imageFetch?: typeof fetch } = {},
): Promise<SweepOutcome> {
  const now = clock.now();
  const variantId = tracked.variantId;
  if ((await liveSearchesUsed(db, now)) >= config.SERPAPI_MONTHLY_BUDGET) return { variantId, kind: "skipped", reason: "monthly_budget_exhausted" };
  if (opts.ignoreDailyCap) {
    // Explicit operator bootstrap: still counted in today's usage, still bounded by the rolling cap.
    const day = now.toISOString().slice(0, 10);
    await db.sourceBudgetDay.upsert({ where: { sourceId_day: { sourceId: SERPAPI_SOURCE_ID, day } }, create: { sourceId: SERPAPI_SOURCE_ID, day, used: 1 }, update: { used: { increment: 1 } } });
  } else {
    const b = await reserveSourceRequest(db, SERPAPI_SOURCE_ID, now);
    if (!b.ok) return { variantId, kind: "skipped", reason: b.reason === "budget_exhausted" ? "daily_budget_exhausted" : b.reason };
  }
  await db.liveSweep.update({ where: { variantId }, data: { lastAttemptAt: now } });
  try {
    const s = await withTimeout(SWEEP_TIMEOUT_MS, (signal) => provider.sweep(tracked, signal));
    const applied = await ingestSweep(db, clock, variantId, s.listings);
    // Picture: image CDNs aren't SerpApi searches, so this costs no credits. Failure is harmless.
    const image = opts.storage && s.thumbnailUrl ? await storeLiveProductImage(db, opts.storage, clock, tracked.productId, s.thumbnailUrl, opts.imageFetch) : false;
    const done = clock.now();
    await recordSourceSuccess(db, SERPAPI_SOURCE_ID, done);
    const result = { listings: s.listings.length, applied, matched: s.matched, rejected: s.rejected, implausible: s.implausible, skipped: s.skipped, total: s.total, image };
    await db.liveSweep.update({
      where: { variantId },
      data: { lastSuccessAt: done, nextDueAt: new Date(done.getTime() + config.SERPAPI_REFRESH_HOURS * 3600_000), lastResult: result, lastErrorCode: null },
    });
    return { variantId, kind: "swept", listings: s.listings.length, applied, matched: s.matched, rejected: s.rejected, implausible: s.implausible, image, ...(opts.debug ? { rejectedTitles: s.rejectedTitles } : {}) };
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("invalid_response", "Unexpected sweep failure");
    const at = clock.now();
    await recordSourceFailure(db, SERPAPI_SOURCE_ID, at, pe.code, pe.retryAfterMs);
    const retry = new Date(at.getTime() + Math.max(pe.retryAfterMs ?? 0, RETRY_AFTER_FAILURE_MS));
    await db.liveSweep.update({ where: { variantId }, data: { nextDueAt: retry, lastErrorCode: pe.code } });
    return { variantId, kind: "failed", code: pe.code };
  }
}

/** Sweep due variants (oldest first), at most `max` searches. Stops at the first budget block. */
export async function sweepDueLiveVariants(
  db: Db,
  clock: Clock,
  config: AppConfig,
  provider: SerpApiShoppingProvider,
  opts: { max?: number; ignoreDailyCap?: boolean; debug?: boolean; all?: boolean; log?: Logger; storage?: ObjectStore; imageFetch?: typeof fetch } = {},
): Promise<SweepOutcome[]> {
  const now = clock.now();
  const due = await db.liveSweep.findMany({
    where: { sourceId: SERPAPI_SOURCE_ID, ...(opts.all ? {} : { nextDueAt: { lte: now } }) },
    orderBy: [{ nextDueAt: "asc" }, { variantId: "asc" }],
    take: Math.max(0, opts.max ?? 3),
  });
  const out: SweepOutcome[] = [];
  for (const d of due) {
    const tracked = LIVE_VARIANTS.find((v) => v.variantId === d.variantId);
    if (!tracked) continue;
    const r = await sweepLiveVariant(db, clock, config, provider, tracked, opts);
    out.push(r);
    opts.log?.info("live sweep", { ...r });
    if (r.kind === "skipped") break;
    if (r.kind === "failed" && ["invalid_credentials", "permission_denied", "quota_exhausted"].includes(r.code)) break;
  }
  return out;
}

export async function liveSweepStatus(db: Db, config: AppConfig, now: Date) {
  const rows = await db.liveSweep.findMany({ where: { sourceId: SERPAPI_SOURCE_ID }, orderBy: { variantId: "asc" } });
  return {
    used30d: await liveSearchesUsed(db, now),
    monthlyBudget: config.SERPAPI_MONTHLY_BUDGET,
    dailyBudget: config.SERPAPI_DAILY_BUDGET,
    refreshHours: config.SERPAPI_REFRESH_HOURS,
    variants: rows.map((r) => ({ variantId: r.variantId, lastSuccessAt: r.lastSuccessAt?.toISOString() ?? null, nextDueAt: r.nextDueAt.toISOString(), lastErrorCode: r.lastErrorCode, lastResult: r.lastResult })),
  };
}
