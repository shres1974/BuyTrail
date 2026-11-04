import { deleteWatch, getOwnedWatch, updateWatch, watchDTO } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route(async (_req: Request, ctx: Ctx) => {
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok(await watchDTO(s.db, await getOwnedWatch(s.db, actor, id), s.clock.now()));
});

export const PATCH = route(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  return ok(await updateWatch(s.db, s.config, s.clock.now(), actor, id, await readJson(req)));
});

export const DELETE = route(async (req: Request, ctx: Ctx) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  await deleteWatch(s.db, actor, id);
  return ok({ deleted: true });
});
