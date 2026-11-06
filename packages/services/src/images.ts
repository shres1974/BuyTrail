/**
 * Product pictures. Sample products use original illustrations shipped with the web app
 * (/sample-images). Live products use the Google Shopping thumbnail from a matched listing,
 * downloaded once by the server, validated and re-encoded with sharp, stored privately and served
 * from BuyTrail's own origin, so visitors' browsers never contact third-party image hosts.
 */
import type { Db } from "@buytrail/db";
import { sha256, type Clock } from "@buytrail/domain";
import { safeThumbnail } from "@buytrail/providers";
import type { ObjectStore } from "./storage";

export const PRODUCT_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PRODUCT_IMAGE_SIZE = 400;
const MAX_INPUT_PIXELS = 4096 * 4096;

/** Original illustration per fictional sample product (files in apps/web/public/sample-images). */
export const SAMPLE_PRODUCT_IMAGES: Record<string, string> = {
  prod_demo_northline_quiet2: "/sample-images/northline-quiet-2.svg",
  prod_demo_northline_pulse: "/sample-images/northline-pulse-buds.svg",
  prod_demo_fernway_studio: "/sample-images/fernway-studio-one.svg",
  prod_demo_fernway_airlite: "/sample-images/fernway-air-lite-3.svg",
  prod_demo_clearpeak_cp27q: "/sample-images/clearpeak-cp27q.svg",
  prod_demo_clearpeak_cp24f: "/sample-images/clearpeak-cp24f.svg",
  prod_demo_clearpeak_cp32u: "/sample-images/clearpeak-cp32u.svg",
  prod_demo_vantro_v27: "/sample-images/vantro-v27-studio.svg",
  prod_demo_vantro_v24: "/sample-images/vantro-v24-office.svg",
  prod_demo_vantro_v34: "/sample-images/vantro-v34-wide.svg",
  prod_demo_hearthwell_kettle: "/sample-images/hearthwell-brew-kettle.svg",
  prod_demo_hearthwell_toaster: "/sample-images/hearthwell-toast.svg",
  prod_demo_kitchory_blend: "/sample-images/kitchory-blend-mini.svg",
  prod_demo_kitchory_rice: "/sample-images/kitchory-rice-cooker.svg",
  prod_demo_kitchory_airfryer: "/sample-images/kitchory-air-fryer.svg",
};

export const productImageKey = (productId: string) => `product-images/${sha256(`product-image:${productId}`).slice(0, 32)}.webp`;

/** Public URL for a product picture, or null when none is available. */
export function productImagePath(p: { id: string; isDemo: boolean; imageUrl: string | null }): string | null {
  if (p.isDemo) return SAMPLE_PRODUCT_IMAGES[p.id] ?? null;
  return p.imageUrl ? `/api/products/${encodeURIComponent(p.id)}/image?v=${encodeURIComponent(p.imageUrl.slice(-12))}` : null;
}

/**
 * Download a live product thumbnail (bounded, allow-listed hosts only), re-encode it to a square
 * WebP and store it. Re-encoding strips metadata and anything that isn't pixels. Returns false
 * (and leaves any existing picture) on any failure.
 */
export async function storeLiveProductImage(
  db: Db,
  storage: ObjectStore,
  clock: Clock,
  productId: string,
  thumbnailUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const url = safeThumbnail(thumbnailUrl);
  if (!url) return false;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(10_000), redirect: "error", headers: { accept: "image/*" } });
    if (!res.ok || !/^image\//i.test(res.headers.get("content-type") ?? "")) return false;
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > PRODUCT_IMAGE_MAX_BYTES) return false;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0 || bytes.length > PRODUCT_IMAGE_MAX_BYTES) return false;
    const { default: sharp } = await import("sharp");
    const webp = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize(PRODUCT_IMAGE_SIZE, PRODUCT_IMAGE_SIZE, { fit: "contain", background: "#ffffff" })
      .flatten({ background: "#ffffff" })
      .webp({ quality: 82 })
      .toBuffer();
    await storage.put(productImageKey(productId), webp, "image/webp");
    // imageUrl stores the content fingerprint (cache-busting), not the third-party URL.
    await db.product.update({ where: { id: productId }, data: { imageUrl: `stored:${sha256(webp).slice(0, 16)}`, updatedAt: clock.now() } });
    return true;
  } catch {
    return false;
  }
}

/** Read a stored live product picture (null when none). */
export async function readProductImage(db: Db, storage: ObjectStore, productId: string): Promise<Buffer | null> {
  const p = await db.product.findUnique({ where: { id: productId }, select: { isDemo: true, imageUrl: true } });
  if (!p || p.isDemo || !p.imageUrl) return null;
  return storage.get(productImageKey(productId), PRODUCT_IMAGE_MAX_BYTES);
}
