import { productDetail } from "@buytrail/services";
import { ok, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return ok(await productDetail(services().db, id));
});
