import { z } from "zod";
import { parseMajor } from "@buytrail/domain";
import { AppError, simulateDemoPrice } from "@buytrail/services";
import { assertSameOrigin, ok, rateLimit, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/**
 * Demonstration-only: script a price change for a demo listing and run it through the normal
 * ingestion → evaluation → notification pipeline. Disabled outside demo/local mode.
 */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  if (s.config.APP_MODE === "live") throw new AppError("UNSUPPORTED", "Price simulation is only available in demonstration mode.");
  const actor = await requireActor();
  await rateLimit(`simulate:${actor.id}`, 30);
  const body = z.object({ externalListingId: z.string().max(64), itemPrice: z.string().max(20).nullable() }).parse(await readJson(req));
  const price = body.itemPrice === null ? null : parseMajor(body.itemPrice);
  const r = await simulateDemoPrice(s.db, s.clock, body.externalListingId, price);
  return ok({ result: r.kind, label: "Sample price change — demonstration mode" });
});
