/**
 * Product pictures: sample illustrations map to fictional products; live thumbnails are fetched
 * only from allow-listed hosts, size-bounded, re-encoded and served from our own origin.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { DEMO_PRODUCTS, LIVE_VARIANT_BY_ID, safeThumbnail, SerpApiShoppingProvider } from "@buytrail/providers";
import { createMemoryStore, productImageKey, productImagePath, readProductImage, SAMPLE_PRODUCT_IMAGES, seedLiveCatalog, storeLiveProductImage, sweepLiveVariant } from "../src";
import { FIXTURE } from "../../providers/test/serpapi-fixture";
import { seeded, type Kit } from "./kit";

let k: Kit;
let png: Buffer;
const PID = "prod_live_sony_wh1000xm5";
const THUMB = "https://serpapi.com/images/url/abc123";
const imageFetch = (body: Buffer, type = "image/png", status = 200) => (async () => new Response(new Uint8Array(body), { status, headers: { "content-type": type } })) as unknown as typeof fetch;

beforeAll(async () => {
  k = await seeded({ LIVE_PROVIDERS_ENABLED: "true", SERPAPI_API_KEY: "k_test" });
  await seedLiveCatalog(k.db, k.config, k.clock.now());
  png = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
}, 120_000);

describe("sample illustrations", () => {
  it("every fictional product has an illustration file shipped with the web app", () => {
    for (const p of DEMO_PRODUCTS) {
      const url = SAMPLE_PRODUCT_IMAGES[p.id];
      expect(url, p.id).toMatch(/^\/sample-images\/[a-z0-9-]+\.svg$/);
      expect(existsSync(path.resolve(import.meta.dirname, "../../../apps/web/public", url!.slice(1))), url).toBe(true);
      expect(productImagePath({ id: p.id, isDemo: true, imageUrl: null })).toBe(url);
    }
  });
});

describe("live thumbnails", () => {
  it("only https SerpApi/Google image hosts are accepted", () => {
    expect(safeThumbnail("https://serpapi.com/images/url/x")).not.toBeNull();
    expect(safeThumbnail("https://encrypted-tbn1.gstatic.com/shopping?q=tbn:x&amp;usqp=CAc")).toBe("https://encrypted-tbn1.gstatic.com/shopping?q=tbn:x&usqp=CAc");
    expect(safeThumbnail("http://serpapi.com/x")).toBeNull();
    expect(safeThumbnail("https://evil.example/x.png")).toBeNull();
    expect(safeThumbnail("https://serpapi.com.evil.example/x")).toBeNull();
    expect(safeThumbnail("https://user:pw@serpapi.com/x")).toBeNull();
    expect(safeThumbnail("https://169.254.169.254/latest")).toBeNull();
  });

  it("stores a re-encoded square WebP and exposes a same-origin URL", async () => {
    expect(await storeLiveProductImage(k.db, k.storage, k.clock, PID, THUMB, imageFetch(png))).toBe(true);
    const stored = await readProductImage(k.db, k.storage, PID);
    const meta = await sharp(stored!).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["webp", 400, 400]);
    const p = await k.db.product.findUniqueOrThrow({ where: { id: PID } });
    expect(p.imageUrl).toMatch(/^stored:[0-9a-f]{16}$/);
    expect(productImagePath(p)).toMatch(new RegExp(`^/api/products/${PID}/image\\?v=`));
  });

  it("rejects non-images, oversize and broken files without touching the existing picture", async () => {
    const before = (await k.db.product.findUniqueOrThrow({ where: { id: PID } })).imageUrl;
    expect(await storeLiveProductImage(k.db, k.storage, k.clock, PID, THUMB, imageFetch(Buffer.from("<html>"), "text/html"))).toBe(false);
    expect(await storeLiveProductImage(k.db, k.storage, k.clock, PID, THUMB, imageFetch(Buffer.alloc(3 * 1024 * 1024, 1)))).toBe(false);
    expect(await storeLiveProductImage(k.db, k.storage, k.clock, PID, THUMB, imageFetch(Buffer.from("not really a png")))).toBe(false);
    expect(await storeLiveProductImage(k.db, k.storage, k.clock, PID, THUMB, imageFetch(png, "image/png", 404))).toBe(false);
    expect(await storeLiveProductImage(k.db, k.storage, k.clock, PID, "https://evil.example/x.png", imageFetch(png))).toBe(false);
    expect((await k.db.product.findUniqueOrThrow({ where: { id: PID } })).imageUrl).toBe(before);
  });

  it("sample products never read from storage", async () => {
    await k.storage.put(productImageKey("prod_demo_northline_quiet2"), png, "image/png");
    expect(await readProductImage(k.db, k.storage, "prod_demo_northline_quiet2")).toBeNull();
  });

  it("a sweep attaches the picture from a matching listing (no extra SerpApi search)", async () => {
    const id = "prod_live_sony_wf1000xm5";
    const tracked = { ...LIVE_VARIANT_BY_ID.get("var_live_sony_wh1000xm5_black")!, productId: id };
    let searches = 0;
    const body = JSON.parse(JSON.stringify(FIXTURE)) as { shopping_results: Array<Record<string, unknown>> };
    body.shopping_results[0]!.serpapi_thumbnail = THUMB;
    const provider = new SerpApiShoppingProvider({ apiKey: "k", clock: k.clock, fetchImpl: (async () => (searches++, new Response(JSON.stringify(body)))) as unknown as typeof fetch });
    const r = await sweepLiveVariant(k.db, k.clock, k.config, provider, tracked, { storage: k.storage, imageFetch: imageFetch(png), ignoreDailyCap: true });
    expect(r).toMatchObject({ kind: "swept", image: true });
    expect(searches).toBe(1);
    expect(await readProductImage(k.db, k.storage, id)).not.toBeNull();
    const store = createMemoryStore();
    const r2 = await sweepLiveVariant(k.db, k.clock, k.config, provider, tracked, { storage: store, imageFetch: imageFetch(Buffer.from("x"), "text/plain"), ignoreDailyCap: true });
    expect(r2).toMatchObject({ kind: "swept", image: false });
  });
});
