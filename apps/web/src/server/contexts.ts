import { AppError } from "@buytrail/services";
import { currentActor } from "./http";
import { services } from "./services";

/** Public contexts are open; private contexts only to their owner (404 otherwise). */
export async function assertContextReadable(contextId: string) {
  const ctx = await services().db.quoteContext.findUnique({ where: { id: contextId } });
  if (!ctx) throw new AppError("NOT_FOUND", "Quote context not found");
  if (ctx.ownerUserId) {
    const a = await currentActor();
    if (!a || a.id !== ctx.ownerUserId) throw new AppError("NOT_FOUND", "Quote context not found");
  }
}
