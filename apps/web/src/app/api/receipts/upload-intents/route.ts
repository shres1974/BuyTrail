import { createUploadIntent } from "@buytrail/services";
import { assertSameOrigin, ok, rateLimit, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  await rateLimit(`upload-intent:${actor.id}`, 20);
  return ok(await createUploadIntent(s.db, s.config, s.clock.now(), actor, await readJson(req)), 201);
});
