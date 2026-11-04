import { getOwnedPurchase, updatePurchase } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok(await getOwnedPurchase(services().db, actor, id));
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok(await updatePurchase(s.db, s.clock.now(), actor, id, await readJson(req)));
});
