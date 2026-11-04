import { z } from "zod";
import { PUBLIC_CONTEXT_ID, variantOffers } from "@buytrail/services";
import { assertContextReadable } from "@/server/contexts";
import { ok, route } from "@/server/http";
import { services } from "@/server/services";

const q = z.object({ condition: z.enum(["new", "refurbished", "used"]).default("new"), contextId: z.string().max(100).default(PUBLIC_CONTEXT_ID) });

export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const p = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  await assertContextReadable(p.contextId);
  const s = services();
  return ok(await variantOffers(s.db, id, p.contextId, p.condition, s.clock.now()));
});
