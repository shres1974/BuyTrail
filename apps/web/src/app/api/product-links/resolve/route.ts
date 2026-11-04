import { z } from "zod";
import { parseProductLink, type LinkRule } from "@buytrail/domain";
import { DEMO_MERCHANTS } from "@buytrail/providers";
import { AppError, PUBLIC_CONTEXT_ID } from "@buytrail/services";
import { assertSameOrigin, ok, rateLimit, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/**
 * Parse a supported product link and map it to a known listing. Never fetches the URL (S10):
 * only exact allowlisted HTTPS hosts and recognized paths are accepted.
 */
const RULES: LinkRule[] = DEMO_MERCHANTS.map((m) => ({ sourceId: m.sourceId, hosts: [m.host], pathPattern: /^\/p\/([A-Za-z0-9-]{2,64})$/ }));

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  await rateLimit(`link:${actor.id}`, 20);
  const { url } = z.object({ url: z.string().max(2048) }).parse(await readJson(req));
  const parsed = parseProductLink(url, RULES);
  if (!parsed.ok) throw new AppError("UNSUPPORTED", `This link isn't from a supported store (${parsed.reason.replace(/_/g, " ")}).`);
  const listing = await s.db.sourceListing.findFirst({ where: { sourceId: parsed.sourceId, externalListingId: parsed.externalListingId } });
  if (!listing) throw new AppError("NOT_FOUND", "That listing is not in the current catalog.");
  if (listing.matchStatus !== "verified" || !listing.variantId) {
    return ok({ status: "under_review", message: "This listing is awaiting an exact-variant match review.", contextId: PUBLIC_CONTEXT_ID });
  }
  const v = await s.db.productVariant.findUniqueOrThrow({ where: { id: listing.variantId } });
  return ok({ status: "matched", productId: v.productId, variantId: v.id });
});
