import { downloadReceipt } from "@buytrail/services";
import { requireActor, route } from "@/server/http";
import { services } from "@/server/services";

/**
 * Authenticated streaming download (no long-lived signed URLs): access is revoked immediately on
 * deletion. Served as an attachment with nosniff so the browser never renders active content.
 */
export const GET = route(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = services();
  const actor = await requireActor();
  const { id } = await ctx.params;
  const variant = new URL(req.url).searchParams.get("variant") === "preview" ? "preview" : "original";
  const r = await downloadReceipt(s.db, s.config, s.storage, actor, id, variant);
  const ext = r.contentType === "application/pdf" ? "pdf" : r.contentType === "image/png" ? "png" : "jpg";
  return new Response(new Uint8Array(r.bytes), {
    headers: {
      "content-type": r.contentType,
      "content-disposition": variant === "preview" ? "inline" : `attachment; filename="receipt-${id}.${ext}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
