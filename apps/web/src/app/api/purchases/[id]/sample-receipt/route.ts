import { z } from "zod";
import { AppError, attachSampleReceipt, sampleReceipt, SAMPLE_RECEIPT_IDS } from "@buytrail/services";
import { assertSameOrigin, ok, rateLimit, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/** Attach a bundled synthetic receipt (the demo-safe path; G30). */
export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  await rateLimit(`sample-receipt:${actor.id}`, 20);
  const { id } = await ctx.params;
  const { sampleId } = z.object({ sampleId: z.enum(SAMPLE_RECEIPT_IDS) }).parse(await readJson(req));
  const sample = sampleReceipt(sampleId);
  if (!sample) throw new AppError("VALIDATION_FAILED", "Unknown sample");
  return ok(await attachSampleReceipt(s.db, s.config, s.storage, s.clock.now(), actor, id, sample), 201);
});
