import { adminImport } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/** Approved-source CSV import (bounded: 2 MiB body, 5000 rows). */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  return ok(await adminImport(s.db, s.clock, await requireActor(), await readJson(req, 2 * 1024 * 1024 + 4096)));
});
