import { createWatch, listWatches } from "@buytrail/services";
import { assertSameOrigin, ok, rateLimit, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async () => {
  const s = services();
  const actor = await requireActor();
  return ok({ items: await listWatches(s.db, s.clock.now(), actor) });
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  await rateLimit(`watch-create:${actor.id}`, 30);
  const body = await readJson(req);
  const r = await createWatch(s.db, s.config, s.clock.now(), actor, body, req.headers.get("idempotency-key"));
  return ok({ watch: r.dto, alreadyQualifying: r.alreadyQualifying, replay: r.replay }, r.replay ? 200 : 201);
});
