import { z } from "zod";
import { isCategoryKey } from "@buytrail/domain";
import { searchCatalog } from "@buytrail/services";
import { clientKey, ok, rateLimit, route } from "@/server/http";
import { services } from "@/server/services";

const schema = z.object({
  q: z.string().max(200).default(""),
  category: z.string().optional().refine((c) => !c || isCategoryKey(c), "Unsupported category"),
  condition: z.enum(["new", "refurbished", "used"]).default("new"),
  sort: z.enum(["relevance", "lowest_total"]).default("relevance"),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: z.string().max(2048).optional(),
});

/** Public catalog search. Rate-limited; reads only the stored, permitted catalog. */
export const GET = route(async (req: Request) => {
  const s = services();
  await rateLimit(`search:${await clientKey()}`, s.config.SEARCH_RATE_LIMIT_PER_MINUTE);
  const url = new URL(req.url);
  const p = schema.parse(Object.fromEntries([...url.searchParams].filter(([k]) => !k.startsWith("f."))));
  const filters = Object.fromEntries([...url.searchParams].filter(([k]) => k.startsWith("f.")).map(([k, v]) => [k.slice(2), v.slice(0, 100)]));
  const r = await searchCatalog(s.db, { ...p, category: p.category as never, filters }, s.clock.now(), s.config.AUTH_SECRET);
  return ok(r);
});
