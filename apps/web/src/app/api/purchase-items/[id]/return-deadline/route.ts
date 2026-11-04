import { removeReturnDeadline, setReturnDeadline } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const PUT = route(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok(await setReturnDeadline(s.db, s.config, s.clock.now(), actor, id, await readJson(req)));
});

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok({ purchase: await removeReturnDeadline(s.db, s.clock.now(), actor, id) });
});
