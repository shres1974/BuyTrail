import { adminMatchQueue } from "@buytrail/services";
import { ok, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async () => ok({ items: await adminMatchQueue(services().db, await requireActor()) }));
