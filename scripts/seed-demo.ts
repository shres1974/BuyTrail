/**
 * pnpm seed:demo — rerunnable, demo-scoped seed. Never truncates. Refuses live mode.
 * Seeds sources, merchants, catalog and 21 days of clearly labelled demo price history
 * through the real ingestion pipeline.
 */
import "./_env";
import { loadConfig } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { systemClock } from "@buytrail/domain";
import { demoSeedState, seedDemoCatalog, seedDemoListings, syncRefreshSchedules } from "@buytrail/services";

async function main() {
  const config = loadConfig();
  if (config.APP_MODE === "live") throw new Error("seed:demo refuses to run in live mode");
  const db = getPrisma();
  const t0 = Date.now();
  const cat = await seedDemoCatalog(db);
  const before = await demoSeedState(db);
  const days = before.quotes > 0 ? 0 : 21; // history only on first seed; reruns add one fresh check
  const r = await seedDemoListings(db, systemClock, { historyDays: days });
  await syncRefreshSchedules(db, systemClock.now(), { watchedSeconds: 15 * 60, idleSeconds: 4 * 3600 });
  const after = await demoSeedState(db);
  console.log(
    JSON.stringify({ ok: true, products: cat.products, variants: cat.variants, listings: after.listings, quotes: after.quotes, observationsIngested: r.ingested, historyDays: days, ms: Date.now() - t0 }),
  );
  await db.$disconnect();
}

main().catch((e) => {
  console.error(`seed:demo failed: ${e.message}`);
  process.exit(1);
});
