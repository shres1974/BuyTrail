import { z } from "zod";
import { AppError, beginAccountDeletion } from "@buytrail/services";
import { assertSameOrigin, ok, readJson, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/** Begin durable account deletion. Requires typing the account email to confirm. */
export const DELETE = route(async (req: Request) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { confirmEmail } = z.object({ confirmEmail: z.string().max(320) }).parse(await readJson(req));
  if (confirmEmail.trim().toLowerCase() !== actor.email.toLowerCase()) {
    throw new AppError("VALIDATION_FAILED", "Type your account email to confirm deletion.", { fields: { confirmEmail: "Does not match your account email" } });
  }
  await beginAccountDeletion(s.db, s.clock.now(), actor.id);
  return ok({ state: "deleting" }, 202);
});
