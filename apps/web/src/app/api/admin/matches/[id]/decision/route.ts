import { adminDecideMatch } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const POST = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const s = services();
  const { id } = await ctx.params;
  return ok(await adminDecideMatch(s.db, s.clock, await requireActor(), id, await readJson(req)));
});
