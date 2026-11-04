/**
 * Administrator operations: source health, match review queue, approved imports (Section 18).
 * Every function requires an explicit admin actor and writes an audit event.
 */
import type { Db } from "@buytrail/db";
import type { Clock } from "@buytrail/domain";
import { parseFeed } from "@buytrail/providers";
import { z } from "zod";
import { requireAdmin, type Actor } from "./auth-types";
import { AppError } from "./errors";
import { applyMatchCorrection, ingestListing } from "./ingestion";
import { sourceHealth } from "./sources";

export async function adminSources(db: Db, actor: Actor, now: Date) {
  requireAdmin(actor);
  return sourceHealth(db, now);
}

export async function adminMatchQueue(db: Db, actor: Actor, limit = 50) {
  requireAdmin(actor);
  const ds = await db.matchDecision.findMany({
    where: { reviewState: "open", status: { in: ["candidate", "quarantined"] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
    include: { listing: { include: { merchant: true } } },
  });
  const variantIds = [...new Set(ds.flatMap((d) => d.candidateVariantIds))];
  const variants = await db.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: true } });
  return ds.map((d) => ({
    id: d.id,
    status: d.status,
    reason: d.reason,
    evidence: d.evidence,
    ruleVersion: d.ruleVersion,
    createdAt: d.createdAt.toISOString(),
    listing: {
      id: d.listing.id,
      sourceId: d.listing.sourceId,
      externalListingId: d.listing.externalListingId,
      title: d.listing.title,
      brand: d.listing.brand,
      model: d.listing.model,
      identifiers: d.listing.identifiers,
      attributes: d.listing.attributes,
      merchant: d.listing.merchant?.name ?? d.listing.sellerKey,
      isDemo: d.listing.isDemo,
    },
    candidates: d.candidateVariantIds.map((id) => {
      const v = variants.find((x) => x.id === id);
      return v ? { id, title: `${v.product.title} — ${v.label}`, modelCode: v.modelCode, attributes: v.attributes } : { id, title: id, modelCode: "", attributes: {} };
    }),
  }));
}

export const matchDecisionSchema = z.object({
  action: z.enum(["verify", "reject"]),
  variantId: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

export async function adminDecideMatch(db: Db, clock: Clock, actor: Actor, decisionId: string, raw: unknown) {
  requireAdmin(actor);
  const input = matchDecisionSchema.parse(raw);
  if (input.action === "verify" && !input.variantId) throw new AppError("VALIDATION_FAILED", "Choose the variant to link", { fields: { variantId: "Required" } });
  try {
    const r = await applyMatchCorrection(db, clock, { decisionId, adminUserId: actor.id, ...input });
    if (!r) throw new AppError("NOT_FOUND", "Match decision not found");
    return r;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("VALIDATION_FAILED", (e as Error).message);
  }
}

export const importSchema = z.object({
  sourceId: z.string().min(1).max(100),
  csv: z.string().min(1),
});

/** Import an authorized CSV feed for a non-demo, approved source. Bounded and idempotent per listing. */
export async function adminImport(db: Db, clock: Clock, actor: Actor, raw: unknown) {
  requireAdmin(actor);
  const input = importSchema.parse(raw);
  const source = await db.source.findUnique({ where: { id: input.sourceId } });
  if (!source) throw new AppError("NOT_FOUND", "Source not found");
  if (source.mode === "demo") throw new AppError("UNSUPPORTED", "Demo sources are seeded, not imported.");
  if (source.approvalStatus !== "approved" || source.status === "disabled") {
    throw new AppError("FORBIDDEN", "This source is not approved for import. Record verified permissions in docs/source-capabilities.md first.");
  }
  const contexts = await db.quoteContext.findMany({ where: { ownerUserId: null, market: "CA" }, take: 1 });
  const ctx = contexts[0];
  if (!ctx) throw new AppError("UNAVAILABLE", "No public quote context configured");
  const parsed = parseFeed(input.csv, { sourceId: source.id, sourceMode: source.mode as "live" | "sandbox", fetchedAt: clock.now(), allowedHosts: source.allowedHosts });
  let applied = 0;
  for (const l of parsed.listings) {
    const r = await ingestListing(db, clock, l, ctx.id, null, false);
    if (r?.applied) applied++;
  }
  await db.auditEvent.create({ data: { actorId: actor.id, action: "source.import", resource: `source:${source.id}`, metadata: { rows: parsed.listings.length, errors: parsed.errors.length, applied } } });
  return { accepted: parsed.listings.length, applied, errors: parsed.errors.slice(0, 100) };
}
