import { readiness } from "@buytrail/services";
import { ok, route } from "@/server/http";
import { services } from "@/server/services";

/** Readiness. Public; exposes no credentials, account counts or infrastructure addresses. */
export const GET = route(async () => {
  const s = services();
  const r = await readiness(s.db, s.clock.now());
  return ok({ status: r.database ? "ok" : "degraded", mode: s.config.APP_MODE, ...r }, r.database ? 200 : 503);
});
