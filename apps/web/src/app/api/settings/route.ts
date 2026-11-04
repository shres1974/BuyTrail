import { getSettings, updateSettings } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async () => ok(await getSettings(services().db, await requireActor())));

export const PATCH = route(async (req: Request) => {
  assertSameOrigin(req);
  return ok(await updateSettings(services().db, await requireActor(), await readJson(req)));
});
