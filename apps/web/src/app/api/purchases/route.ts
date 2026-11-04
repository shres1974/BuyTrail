import { createPurchase, listPurchases } from "@buytrail/services";
import { assertSameOrigin, ok, rateLimit, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async (req: Request) => {
  const s = services();
  const actor = await requireActor();
  const q = new URL(req.url).searchParams.get("q");
  return ok({ items: await listPurchases(s.db, actor, q) });
});

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  await rateLimit(`purchase-create:${actor.id}`, 30);
  const p = await createPurchase(s.db, s.clock.now(), actor, await readJson(req), req.headers.get("idempotency-key"), { isDemo: s.config.APP_MODE === "demo" });
  return ok(p, 201);
});
