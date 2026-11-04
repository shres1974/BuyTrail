import { confirmUpload } from "@buytrail/services";
import { assertSameOrigin, ok, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok(await confirmUpload(s.db, s.storage, s.clock.now(), actor, id));
});
