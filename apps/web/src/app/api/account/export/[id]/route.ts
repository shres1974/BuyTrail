import { downloadExport } from "@buytrail/services";
import { requireActor, route } from "@/server/http";
import { services } from "@/server/services";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  const bytes = await downloadExport(s.db, s.storage, s.clock.now(), actor, id);
  return new Response(new Uint8Array(bytes), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="buytrail-export-${id}.zip"`, "cache-control": "private, no-store" },
  });
});
