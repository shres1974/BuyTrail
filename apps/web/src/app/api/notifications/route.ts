import { z } from "zod";
import { listNotifications, markNotificationsRead } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async () => {
  const s = services();
  const actor = await requireActor();
  return ok({ items: await listNotifications(s.db, actor.id) });
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { ids } = z.object({ ids: z.array(z.string().max(100)).max(100) }).parse(await readJson(req));
  return ok({ marked: await markNotificationsRead(s.db, actor.id, ids, s.clock.now()) });
});
