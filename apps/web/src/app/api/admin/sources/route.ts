import { adminSources } from "@buytrail/services";
import { ok, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async () => {
  const s = services();
  return ok({ items: await adminSources(s.db, await requireActor(), s.clock.now()) });
});
