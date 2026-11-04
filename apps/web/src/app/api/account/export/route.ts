import { listExports, requestExport } from "@buytrail/services";
import { assertSameOrigin, ok, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async () => {
  const s = services();
  return ok({ items: await listExports(s.db, s.clock.now(), await requireActor()) });
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  return ok(await requestExport(s.db, s.clock.now(), await requireActor()), 202);
});
