import { AppError, receiveUpload } from "@buytrail/services";
import { assertSameOrigin, ok, requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/** Receives bytes for an owner-bound upload intent and writes them to private quarantine. */
export const PUT = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  assertSameOrigin(req);
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > s.config.RECEIPT_MAX_BYTES) throw new AppError("LIMIT_EXCEEDED", "File too large");
  // Read with a hard cap regardless of the declared length.
  const reader = req.body?.getReader();
  if (!reader) throw new AppError("VALIDATION_FAILED", "Empty upload");
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > s.config.RECEIPT_MAX_BYTES) throw new AppError("LIMIT_EXCEEDED", "File too large");
    chunks.push(value);
  }
  return ok(await receiveUpload(s.db, s.config, s.storage, s.clock.now(), actor, id, Buffer.concat(chunks), req.headers.get("content-type")));
});
