import { z } from "zod";
import { setItemStatus } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const actor = await requireActor();
  const { id } = await ctx.params;
  const { status } = z.object({ status: z.enum(["kept", "returned"]) }).parse(await readJson(req));
  return ok({ purchase: await setItemStatus(services().db, actor, id, status) });
});
