import { readProductImage } from "@buytrail/services";
import { route } from "@/server/http";
import { services } from "@/server/services";

/** Public product picture for live products, served from BuyTrail's own origin. */
export const GET = route(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const s = services();
  const { id } = await ctx.params;
  const bytes = id.length <= 120 ? await readProductImage(s.db, s.storage, id) : null;
  if (!bytes) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": "image/webp",
      // URLs carry a content fingerprint (?v=), so a changed picture gets a new URL.
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
