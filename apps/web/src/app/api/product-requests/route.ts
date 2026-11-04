import { z } from "zod";
import { assertSameOrigin, clientKey, ok, rateLimit, readJson, route } from "@/server/http";
import { services } from "@/server/services";

/** Records demand for an unsupported product. Does not imply the product will be tracked. */
export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  await rateLimit(`product-request:${await clientKey()}`, 10);
  const body = z.object({ query: z.string().trim().min(2).max(200), category: z.string().max(40).optional() }).parse(await readJson(req));
  await services().db.productRequest.create({ data: { query: body.query, category: body.category ?? null } });
  return ok({ recorded: true, message: "Thanks — we recorded the request. This doesn't mean the product or store will be added." }, 201);
});
