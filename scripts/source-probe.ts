/**
 * pnpm source:probe <sourceId> [--limit N] — explicit, bounded, read-only live integration check.
 *
 * No live connector is approved yet (docs/source-capabilities.md), so for non-demo sources this
 * prints the onboarding gate and exits non-zero rather than fabricating a response. For demo
 * sources it exercises the contract (search + lookup + validation) and prints a summary.
 * It never prints credentials or full provider payloads.
 */
import "./_env";
import { loadConfig } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { systemClock } from "@buytrail/domain";
import { validateListing, withTimeout } from "@buytrail/providers";
import { demoProviders, reserveSourceRequest } from "@buytrail/services";

async function main() {
  const sourceId = process.argv[2];
  const limitArg = process.argv.indexOf("--limit");
  const limit = Math.min(10, limitArg > 0 ? Number(process.argv[limitArg + 1]) || 3 : 3);
  if (!sourceId) throw new Error("Usage: pnpm source:probe <sourceId> [--limit N≤10]");
  const config = loadConfig();
  const db = getPrisma();
  const source = await db.source.findUnique({ where: { id: sourceId } });
  if (!source) throw new Error(`Unknown source ${sourceId}`);
  if (source.mode !== "demo") {
    console.log(
      [
        `Source ${sourceId} is mode=${source.mode}, approval=${source.approvalStatus}.`,
        "No adapter is registered for live/sandbox sources in this build. Before probing:",
        " 1. Confirm permitted use and record it in docs/source-capabilities.md",
        " 2. Provide credentials via environment/secret manager (never in git)",
        " 3. Implement the adapter behind the CatalogProvider contract",
        ` 4. Set LIVE_PROVIDERS_ENABLED=true (current: ${config.LIVE_PROVIDERS_ENABLED}) in a non-demo APP_MODE`,
      ].join("\n"),
    );
    process.exitCode = 2;
    return;
  }
  const provider = demoProviders(systemClock, db).get(sourceId)!;
  const budget = await reserveSourceRequest(db, sourceId, new Date());
  if (!budget.ok) throw new Error(`Budget/rate limit prevents probing: ${budget.reason} until ${budget.retryAt.toISOString()}`);
  const t0 = Date.now();
  const res = await withTimeout(10_000, () => provider.search({ query: "", limit }));
  const ok = res.items.map((i) => validateListing(i));
  const one = ok[0] ? await provider.lookup({ externalListingId: ok[0].externalListingId, externalVariantKey: ok[0].externalVariantKey, sellerKey: ok[0].sellerKey, contextKey: "ca-national" }) : null;
  console.log(
    JSON.stringify(
      {
        sourceId,
        mode: source.mode,
        capabilities: provider.capabilities(),
        searched: ok.length,
        sample: ok.map((l) => ({ id: l.externalListingId, condition: l.condition, stock: l.stock, currency: l.itemPrice?.currency ?? null, shipping: l.shipping.kind, gtins: l.identifiers.length })),
        lookupOk: !!one,
        ms: Date.now() - t0,
        note: "Demo source: synthetic data only.",
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(`source:probe failed: ${e.message}`);
  process.exit(1);
});
