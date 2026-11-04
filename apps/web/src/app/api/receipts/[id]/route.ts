import { deleteReceipt } from "@buytrail/services";
import { assertSameOrigin, ok, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const DELETE = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  await deleteReceipt(s.db, s.clock.now(), actor, id);
  return ok({ deleted: true });
});
