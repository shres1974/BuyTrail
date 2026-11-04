/**
 * Staged ingestion (Section 11) and matching persistence (Section 12).
 *
 * 1. claimRefresh: allocate a monotonic generation for (listing, context) and a lease.
 * 2. Call the provider outside any DB transaction, with a timeout and budget reservation.
 * 3. acceptObservation: validate/normalize, persist an immutable observation, and update the
 *    current quote only if this generation is newer than the applied one (G14).
 * 4. Bump the variant evaluation generation and enqueue watch evaluation through the outbox.
 */
import { Prisma, withTx, type Db, type Tx } from "@buytrail/db";
import {
  checkPriceAnomaly,
  effectiveExpiry,
  matchListing,
  money,
  normalizeIdentifier,
  normalizeModel,
  resolveShipping,
  addMoney,
  isCategoryKey,
  type ListingForMatch,
  type VariantForMatch,
  type Clock,
  type Money,
} from "@buytrail/domain";
import { ProviderError, withTimeout, type CatalogProvider, type NormalizedListing } from "@buytrail/providers";
import { enqueueOutbox } from "./outbox";
import { parseCapabilities, recordSourceFailure, recordSourceSuccess, reserveSourceRequest } from "./sources";

export const NORMALIZATION_VERSION = "norm-v1";
export const REFRESH_LEASE_MS = 60_000;
export const PROVIDER_TIMEOUT_MS = 10_000;

// ── Generations ───────────────────────────────────────────────────────────────────────────

export async function nextGeneration(tx: Tx | Db): Promise<bigint> {
  const r = await tx.$queryRaw<Array<{ g: bigint }>>`SELECT nextval('eval_generation_seq') AS g`;
  return BigInt(r[0]!.g);
}

/** Record that comparison input for (variant, context) changed; enqueue watch evaluation. */
export async function bumpVariantGeneration(tx: Tx, variantId: string, contextId: string, reason: string, now: Date): Promise<bigint> {
  const g = await nextGeneration(tx);
  await tx.$executeRaw`
    INSERT INTO variant_eval_generation ("variantId", "contextId", "generation", "updatedAt")
    VALUES (${variantId}, ${contextId}, ${g}, now())
    ON CONFLICT ("variantId", "contextId") DO UPDATE SET "generation" = GREATEST(variant_eval_generation."generation", EXCLUDED."generation"), "updatedAt" = now()`;
  const watching = await tx.watch.count({ where: { variantId, contextId, lifecycle: "active" } });
  if (watching > 0) await enqueueOutbox(tx, "watch.evaluate_variant", `${variantId}:${contextId}:${reason}`, { variantId, contextId }, now);
  return g;
}

export async function currentVariantGeneration(tx: Tx | Db, variantId: string, contextId: string): Promise<bigint> {
  const r = await tx.variantEvalGeneration.findUnique({ where: { variantId_contextId: { variantId, contextId } } });
  return r?.generation ?? 0n;
}

// ── Matching persistence ──────────────────────────────────────────────────────────────────

export async function loadMatchVariants(tx: Tx | Db, brand: string | null, model: string | null, gtins: string[]): Promise<VariantForMatch[]> {
  const modelN = normalizeModel(model);
  const or: Prisma.ProductVariantWhereInput[] = [];
  if (gtins.length) or.push({ identifiers: { some: { kind: "gtin", normalized: { in: gtins } } } });
  if (brand) {
    // Candidate set for brand+model and for weak title evidence within the brand.
    or.push({ product: { brand: { equals: brand, mode: "insensitive" } } });
  }
  if (modelN) or.push({ modelCodeNormalized: modelN });
  if (!or.length) return [];
  const vs = await tx.productVariant.findMany({ where: { OR: or }, include: { product: true, identifiers: true }, take: 200 });
  return vs
    .filter((v) => isCategoryKey(v.product.category))
    .map((v) => ({
      variantId: v.id,
      category: v.product.category as VariantForMatch["category"],
      brand: v.product.brand,
      modelCode: v.modelCode,
      identifiers: v.identifiers.map((i) => ({ kind: i.kind as "gtin" | "mpn", normalized: i.normalized })),
      attributes: v.attributes as Record<string, string>,
    }));
}

/**
 * Resolve and persist the match for a listing. Never overrides an administrator decision
 * (decidedBy admin:*); a correction goes through applyMatchCorrection.
 */
export async function resolveListingMatch(tx: Tx, listingId: string, n: ListingForMatch, now: Date) {
  const listing = await tx.sourceListing.findUniqueOrThrow({ where: { id: listingId } });
  const lastAdmin = await tx.matchDecision.findFirst({ where: { listingId, decidedBy: { startsWith: "admin:" } }, orderBy: { createdAt: "desc" } });
  if (lastAdmin) return { status: listing.matchStatus, variantId: listing.variantId, changed: false };
  const gtins = n.identifiers
    .filter((i) => i.kind === "gtin")
    .map((i) => normalizeIdentifier("gtin", i.value))
    .flatMap((r) => (r.ok ? [r.normalized] : []));
  const variants = await loadMatchVariants(tx, n.brand, n.model, gtins);
  const d = matchListing(n, variants);
  const variantId = d.status === "verified" ? d.variantId : null;
  const changed = listing.matchStatus !== d.status || listing.variantId !== variantId;
  if (changed) {
    await tx.matchDecision.create({
      data: {
        listingId,
        status: d.status,
        candidateVariantIds: d.status === "verified" ? [d.variantId] : d.status === "unmatched" ? [] : d.variantIds,
        chosenVariantId: variantId,
        previousVariantId: listing.variantId,
        evidence: d.evidence,
        reason: d.status === "verified" ? null : d.reason,
        ruleVersion: d.ruleVersion,
        decidedBy: `rule:${d.ruleVersion}`,
        reviewState: d.status === "verified" ? "resolved" : "open",
        createdAt: now,
      },
    });
    await tx.sourceListing.update({ where: { id: listingId }, data: { matchStatus: d.status, variantId, matchVersion: { increment: 1 } } });
  }
  return { status: d.status, variantId, changed, previousVariantId: listing.variantId };
}

// ── Refresh claims ────────────────────────────────────────────────────────────────────────

export type RefreshClaim = { runId: string; generation: bigint; listingId: string; contextId: string; sourceId: string };

export async function claimRefresh(db: Db, clock: Clock, listingId: string, contextId: string, kind = "lookup"): Promise<RefreshClaim | null> {
  const now = clock.now();
  return withTx(db, async (tx) => {
    // Row lock the listing so concurrent claims serialize and get increasing generations.
    const rows = await tx.$queryRaw<Array<{ id: string; sourceId: string }>>`
      SELECT "id", "sourceId" FROM source_listing WHERE "id" = ${listingId} FOR UPDATE`;
    const l = rows[0];
    if (!l) return null;
    const active = await tx.refreshRun.findFirst({ where: { listingId, contextId, status: "claimed", leaseExpiresAt: { gt: now }, kind } });
    if (active) return null;
    const generation = await nextGeneration(tx);
    await tx.sourceListing.update({ where: { id: listingId }, data: { refreshGeneration: generation } });
    const run = await tx.refreshRun.create({
      data: { sourceId: l.sourceId, listingId, contextId, kind, generation, status: "claimed", attempts: 1, leaseExpiresAt: new Date(now.getTime() + REFRESH_LEASE_MS), claimedAt: now },
    });
    return { runId: run.id, generation, listingId, contextId, sourceId: l.sourceId };
  });
}

// ── Observation acceptance ───────────────────────────────────────────────────────────────

type Computed = {
  itemPrice: Money | null;
  shippingStatus: "known" | "unknown" | "threshold";
  shippingMinor: bigint | null;
  thresholdMinor: bigint | null;
  unknownReason: string | null;
  fees: Money | null;
  knownTotal: Money | null;
};

function compute(n: NormalizedListing): Computed {
  const cur = n.itemPrice?.currency ?? "CAD";
  const itemPrice = n.itemPrice ? money(n.itemPrice.amountMinor, n.itemPrice.currency) : null;
  const fees = n.mandatoryFees ? money(n.mandatoryFees.amountMinor, n.mandatoryFees.currency) : null;
  let shippingStatus: Computed["shippingStatus"] = "unknown";
  let shippingMinor: bigint | null = null;
  let thresholdMinor: bigint | null = null;
  let unknownReason: string | null = null;
  let shippingInfo: Parameters<typeof resolveShipping>[0];
  if (n.shipping.kind === "known") {
    shippingStatus = "known";
    shippingMinor = BigInt(n.shipping.amount.amountMinor);
    shippingInfo = { kind: "known", amount: money(n.shipping.amount.amountMinor, n.shipping.amount.currency) };
  } else if (n.shipping.kind === "threshold") {
    shippingStatus = "threshold";
    thresholdMinor = BigInt(n.shipping.freeAtOrAbove.amountMinor);
    shippingMinor = n.shipping.belowAmount ? BigInt(n.shipping.belowAmount.amountMinor) : null;
    shippingInfo = {
      kind: "threshold",
      freeAtOrAbove: money(n.shipping.freeAtOrAbove.amountMinor, n.shipping.freeAtOrAbove.currency),
      belowAmount: n.shipping.belowAmount ? money(n.shipping.belowAmount.amountMinor, n.shipping.belowAmount.currency) : null,
    };
  } else {
    unknownReason = n.shipping.reason;
    shippingInfo = { kind: "unknown", reason: n.shipping.reason };
  }
  let knownTotal: Money | null = null;
  const sr = resolveShipping(shippingInfo, itemPrice, 1);
  if (itemPrice && sr.known && n.feeStatus === "complete" && sr.amount.currency === cur && (!fees || fees.currency === cur)) {
    knownTotal = addMoney(itemPrice, sr.amount, fees ?? money(0n, itemPrice.currency));
  }
  return { itemPrice, shippingStatus, shippingMinor, thresholdMinor, unknownReason, fees, knownTotal };
}

export type AcceptResult = {
  applied: boolean;
  superseded: boolean;
  observationId: string | null;
  anomaly: string | null;
  matchStatus: string;
  variantId: string | null;
};

/**
 * Persist a validated observation for a claimed refresh. `recordKey` identifies the record
 * within the run (idempotency: the same run+record is stored once, G12).
 */
export async function acceptObservation(
  db: Db,
  clock: Clock,
  claim: RefreshClaim,
  n: NormalizedListing,
  opts: { verification?: boolean } = {},
): Promise<AcceptResult> {
  const now = clock.now();
  return withTx(db, async (tx) => {
    const source = await tx.source.findUniqueOrThrow({ where: { id: claim.sourceId } });
    const caps = parseCapabilities(source.capabilities);
    if (n.sourceId !== source.id || n.sourceMode !== source.mode) throw new ProviderError("invalid_response", "Listing source/mode mismatch");
    if (n.market !== "CA") throw new ProviderError("unsupported_context", "Unsupported market");

    const listing = await tx.sourceListing.findUniqueOrThrow({ where: { id: claim.listingId } });
    // Update source-controlled listing fields (title, identifiers) — latest generation only.
    const isNewestClaim = listing.refreshGeneration === claim.generation;
    if (isNewestClaim) {
      await tx.sourceListing.update({
        where: { id: listing.id },
        data: { title: n.title, brand: n.brand, model: n.model, identifiers: n.identifiers, attributes: n.attributes, outboundUrl: n.outboundUrl, removedAt: null },
      });
    }
    const match = isNewestClaim
      ? await resolveListingMatch(tx, listing.id, { brand: n.brand, model: n.model, identifiers: n.identifiers, attributes: n.attributes, title: n.title }, now)
      : { status: listing.matchStatus, variantId: listing.variantId, changed: false, previousVariantId: listing.variantId };

    const c = compute(n);
    const fetchedAt = new Date(n.fetchedAt);
    const sourceObservedAt = n.sourceObservedAt ? new Date(n.sourceObservedAt) : null;
    const expiresAt = effectiveExpiry({
      fetchedAt,
      sourceObservedAt,
      validUntil: n.validUntil ? new Date(n.validUntil) : null,
      policy: { maxAgeSeconds: source.freshnessSeconds },
    });

    const existing = await tx.offerQuote.findUnique({ where: { listingId_contextId: { listingId: listing.id, contextId: claim.contextId } } });
    const superseded = existing !== null && existing.generation >= claim.generation;

    // Anomaly heuristic vs. last accepted price (Section 15.1). A verification run from an
    // independent source check that reproduces the price confirms it.
    let anomaly: string | null = null;
    let anomalyStatus: "none" | "pending_verification" | "confirmed" = "none";
    if (existing && c.itemPrice && existing.itemPriceMinor !== null && !superseded) {
      if (opts.verification && existing.anomalyStatus === "pending_verification") {
        anomalyStatus = existing.itemPriceMinor === c.itemPrice.amountMinor && existing.currency === c.itemPrice.currency ? "confirmed" : "none";
      } else if (existing.anomalyStatus === "pending_verification" && existing.itemPriceMinor === c.itemPrice.amountMinor) {
        anomalyStatus = "pending_verification"; // same suspicious value; still needs verification
        anomaly = existing.anomalyReason;
      } else {
        const prevPrice = existing.anomalyStatus === "pending_verification" ? null : money(existing.itemPriceMinor, existing.currency === "USD" ? "USD" : "CAD");
        const check = checkPriceAnomaly(prevPrice, c.itemPrice);
        if (check.suspicious) {
          anomalyStatus = "pending_verification";
          anomaly = check.reason;
        }
      }
    }

    // Immutable observation (history only when permitted).
    let observationId: string | null = null;
    if (caps.historyAllowed && source.historyRetentionDays !== null) {
      const retainUntil = new Date(now.getTime() + source.historyRetentionDays * 86400_000);
      try {
        const obs = await tx.priceObservation.create({
          data: {
            listingId: listing.id,
            contextId: claim.contextId,
            sourceId: source.id,
            sourceMode: source.mode,
            runId: claim.runId,
            recordKey: `${n.externalListingId}|${n.externalVariantKey}|${n.sellerKey}`,
            generation: claim.generation,
            condition: n.condition,
            stock: n.stock,
            currency: c.itemPrice?.currency ?? "CAD",
            itemPriceMinor: c.itemPrice?.amountMinor ?? null,
            shippingStatus: c.shippingStatus,
            shippingMinor: c.shippingMinor,
            shippingThresholdMinor: c.thresholdMinor,
            feesMinor: c.fees?.amountMinor ?? null,
            feeStatus: n.feeStatus,
            knownTotalMinor: c.knownTotal?.amountMinor ?? null,
            sourceObservedAt,
            fetchedAt,
            acceptedAt: now,
            normalizationVersion: NORMALIZATION_VERSION,
            matchVersion: listing.matchVersion,
            variantIdAtObservation: match.variantId,
            qualityFlags: anomaly ? [anomaly] : [],
            supersededByNewer: superseded,
            retainUntil,
          },
        });
        observationId = obs.id;
      } catch (e) {
        if ((e as { code?: string }).code === "P2002") {
          // Same run+record already stored: idempotent replay.
          return { applied: false, superseded, observationId: null, anomaly, matchStatus: match.status, variantId: match.variantId };
        }
        throw e;
      }
    }

    const run = await tx.refreshRun.findUnique({ where: { id: claim.runId } });
    await tx.refreshRun.update({ where: { id: claim.runId }, data: { status: superseded ? "superseded" : "succeeded", finishedAt: now, leaseExpiresAt: null } });

    if (superseded || run?.status === "succeeded") {
      return { applied: false, superseded: true, observationId, anomaly, matchStatus: match.status, variantId: match.variantId };
    }

    const data = {
      condition: n.condition,
      stock: n.stock,
      currency: c.itemPrice?.currency ?? "CAD",
      itemPriceMinor: c.itemPrice?.amountMinor ?? null,
      shippingStatus: c.shippingStatus,
      shippingMinor: c.shippingMinor,
      shippingThresholdMinor: c.thresholdMinor,
      shippingUnknownReason: c.unknownReason,
      feesMinor: c.fees?.amountMinor ?? null,
      feeStatus: n.feeStatus,
      restrictions: n.restrictions,
      anomalyStatus,
      anomalyReason: anomaly,
      sourceObservedAt,
      fetchedAt,
      lastSuccessfulCheckAt: now,
      lastCheckFailedAt: null,
      lastCheckFailure: null,
      expiresAt,
      generation: claim.generation,
      observationId,
      invalidatedAt: null,
      expiryNotedAt: null,
    };
    await tx.offerQuote.upsert({
      where: { listingId_contextId: { listingId: listing.id, contextId: claim.contextId } },
      create: { listingId: listing.id, contextId: claim.contextId, ...data },
      update: data,
    });
    if (match.variantId) await bumpVariantGeneration(tx, match.variantId, claim.contextId, `obs:${claim.generation}`, now);
    if (match.changed && match.previousVariantId && match.previousVariantId !== match.variantId) {
      await bumpVariantGeneration(tx, match.previousVariantId, claim.contextId, `unmatch:${claim.generation}`, now);
    }
    if (anomalyStatus === "pending_verification") {
      // Independent re-check from the source (not a re-read of this payload).
      await enqueueOutbox(tx, "refresh.listing", `${listing.id}:verify:${claim.generation}`, { listingId: listing.id, contextId: claim.contextId, reason: "verify_anomaly" }, new Date(now.getTime() + 5_000));
    }
    return { applied: true, superseded: false, observationId, anomaly, matchStatus: match.status, variantId: match.variantId };
  });
}

/** Record a failed check without touching business state (G10): timeout ≠ out of stock. */
export async function recordCheckFailure(db: Db, clock: Clock, claim: RefreshClaim, code: string, detail: string): Promise<void> {
  const now = clock.now();
  await db.$transaction([
    db.refreshRun.update({ where: { id: claim.runId }, data: { status: "failed", finishedAt: now, errorCode: code, errorDetail: detail.slice(0, 500), leaseExpiresAt: null } }),
    db.offerQuote.updateMany({ where: { listingId: claim.listingId, contextId: claim.contextId }, data: { lastCheckFailedAt: now, lastCheckFailure: code } }),
  ]);
}

export type RefreshOutcome =
  | { kind: "accepted"; result: AcceptResult }
  | { kind: "skipped"; reason: string; retryAt?: Date }
  | { kind: "failed"; code: string; retryAt?: Date; permanent: boolean };

/** Full refresh of one (listing, context): budget → claim → provider call → accept. */
export async function refreshListing(
  db: Db,
  clock: Clock,
  providers: Map<string, CatalogProvider>,
  listingId: string,
  contextId: string,
  opts: { verification?: boolean; timeoutMs?: number } = {},
): Promise<RefreshOutcome> {
  const listing = await db.sourceListing.findUnique({ where: { id: listingId } });
  if (!listing) return { kind: "skipped", reason: "listing_missing" };
  const context = await db.quoteContext.findUnique({ where: { id: contextId } });
  if (!context) return { kind: "skipped", reason: "context_missing" };
  const provider = providers.get(listing.sourceId);
  if (!provider) return { kind: "skipped", reason: "source_not_registered" };
  if (!provider.capabilities().lookup) return { kind: "skipped", reason: "lookup_unsupported" };

  const budget = await reserveSourceRequest(db, listing.sourceId, clock.now());
  if (!budget.ok) return { kind: "skipped", reason: budget.reason, retryAt: budget.retryAt };

  const claim = await claimRefresh(db, clock, listingId, contextId, opts.verification ? "verify_anomaly" : "lookup");
  if (!claim) return { kind: "skipped", reason: "already_claimed" };

  let n: NormalizedListing;
  try {
    n = await withTimeout(opts.timeoutMs ?? PROVIDER_TIMEOUT_MS, (signal) =>
      provider.lookup({ externalListingId: listing.externalListingId, externalVariantKey: listing.externalVariantKey, sellerKey: listing.sellerKey, contextKey: "ca-national" }, signal),
    );
  } catch (e) {
    const pe = e instanceof ProviderError ? e : new ProviderError("invalid_response", String((e as Error)?.message ?? e));
    await recordCheckFailure(db, clock, claim, pe.code, pe.message);
    if (pe.code === "removed_listing") {
      await withTx(db, async (tx) => {
        await tx.sourceListing.update({ where: { id: listingId }, data: { removedAt: clock.now() } });
        if (listing.variantId) await bumpVariantGeneration(tx, listing.variantId, contextId, `removed:${claim.generation}`, clock.now());
      });
      return { kind: "failed", code: pe.code, permanent: true };
    }
    await recordSourceFailure(db, listing.sourceId, clock.now(), pe.code, pe.retryAfterMs);
    const permanent = ["invalid_credentials", "permission_denied", "permanent_failure", "unsupported_context", "unsupported_operation"].includes(pe.code);
    return { kind: "failed", code: pe.code, permanent, retryAt: pe.retryAfterMs ? new Date(clock.now().getTime() + pe.retryAfterMs) : undefined };
  }
  if (n.externalListingId !== listing.externalListingId || n.sellerKey !== listing.sellerKey) {
    await recordCheckFailure(db, clock, claim, "invalid_response", "Provider returned a different listing");
    await recordSourceFailure(db, listing.sourceId, clock.now(), "invalid_response", null);
    return { kind: "failed", code: "invalid_response", permanent: false };
  }
  const result = await acceptObservation(db, clock, claim, n, { verification: opts.verification });
  await recordSourceSuccess(db, listing.sourceId, clock.now());
  return { kind: "accepted", result };
}

// ── Import / discovery: upsert listings (no price acceptance without a claim) ──────────────

export async function upsertListingFromSource(db: Db, n: NormalizedListing, merchantId: string | null, isDemo: boolean): Promise<string> {
  const row = await db.sourceListing.upsert({
    where: {
      sourceId_market_externalListingId_externalVariantKey_sellerKey: {
        sourceId: n.sourceId,
        market: n.market,
        externalListingId: n.externalListingId,
        externalVariantKey: n.externalVariantKey,
        sellerKey: n.sellerKey,
      },
    },
    create: {
      sourceId: n.sourceId,
      market: n.market,
      externalListingId: n.externalListingId,
      externalVariantKey: n.externalVariantKey,
      sellerKey: n.sellerKey,
      merchantId,
      title: n.title,
      brand: n.brand,
      model: n.model,
      identifiers: n.identifiers,
      attributes: n.attributes,
      outboundUrl: n.outboundUrl,
      isDemo,
    },
    update: {},
    select: { id: true },
  });
  return row.id;
}

/** Ingest a full normalized listing (import path): upsert listing, claim, accept. */
export async function ingestListing(db: Db, clock: Clock, n: NormalizedListing, contextId: string, merchantId: string | null, isDemo: boolean): Promise<AcceptResult | null> {
  const listingId = await upsertListingFromSource(db, n, merchantId, isDemo);
  const claim = await claimRefresh(db, clock, listingId, contextId, "import");
  if (!claim) return null;
  return acceptObservation(db, clock, claim, n);
}

// ── Expiry sweep: stale quotes change watch input (G11, G28) ───────────────────────────────

export async function sweepExpiredQuotes(db: Db, clock: Clock, limit = 500): Promise<number> {
  const now = clock.now();
  const expired = await db.offerQuote.findMany({
    where: { expiresAt: { lte: now }, expiryNotedAt: null },
    include: { listing: { select: { variantId: true } } },
    take: limit,
  });
  if (!expired.length) return 0;
  const pairs = new Set<string>();
  await withTx(db, async (tx) => {
    await tx.offerQuote.updateMany({ where: { id: { in: expired.map((e) => e.id) } }, data: { expiryNotedAt: now } });
    for (const q of expired) if (q.listing.variantId) pairs.add(`${q.listing.variantId}\u0000${q.contextId}`);
    for (const p of pairs) {
      const [v, c] = p.split("\u0000") as [string, string];
      await bumpVariantGeneration(tx, v, c, `expiry:${now.getTime()}`, now);
    }
  });
  return expired.length;
}

// ── Administrator match correction (Section 12.3) ───────────────────────────────────────────

export async function applyMatchCorrection(
  db: Db,
  clock: Clock,
  input: { decisionId: string; adminUserId: string; action: "verify" | "reject"; variantId?: string; note?: string },
) {
  const now = clock.now();
  return withTx(db, async (tx) => {
    const d = await tx.matchDecision.findUnique({ where: { id: input.decisionId }, include: { listing: true } });
    if (!d) return null;
    const listing = d.listing;
    const prev = listing.variantId;
    let newVariant: string | null = null;
    let status: string;
    if (input.action === "verify") {
      if (!input.variantId) throw new Error("variantId required to verify");
      const v = await tx.productVariant.findUnique({ where: { id: input.variantId } });
      if (!v) throw new Error("Unknown variant");
      newVariant = v.id;
      status = "verified";
    } else {
      status = "rejected";
    }
    await tx.sourceListing.update({ where: { id: listing.id }, data: { variantId: newVariant, matchStatus: status, matchVersion: { increment: 1 } } });
    await tx.matchDecision.update({ where: { id: d.id }, data: { reviewState: "resolved" } });
    await tx.matchDecision.create({
      data: {
        listingId: listing.id,
        status,
        candidateVariantIds: d.candidateVariantIds,
        chosenVariantId: newVariant,
        previousVariantId: prev,
        evidence: { basedOn: d.id, note: input.note ?? null },
        reason: input.note ?? null,
        ruleVersion: "admin",
        decidedBy: `admin:${input.adminUserId}`,
        reviewState: "resolved",
        createdAt: now,
      },
    });
    // Invalidate current quotes until re-observed under the new mapping; recompute affected variants.
    const quotes = await tx.offerQuote.findMany({ where: { listingId: listing.id } });
    await tx.offerQuote.updateMany({ where: { listingId: listing.id }, data: { invalidatedAt: newVariant ? null : now } });
    for (const q of quotes) {
      if (prev) await bumpVariantGeneration(tx, prev, q.contextId, `correction:${d.id}`, now);
      if (newVariant && newVariant !== prev) await bumpVariantGeneration(tx, newVariant, q.contextId, `correction:${d.id}`, now);
    }
    await tx.auditEvent.create({ data: { actorId: input.adminUserId, action: `match.${input.action}`, resource: `listing:${listing.id}`, metadata: { decisionId: d.id, previousVariantId: prev, newVariantId: newVariant } } });
    return { listingId: listing.id, status, previousVariantId: prev, variantId: newVariant };
  });
}
