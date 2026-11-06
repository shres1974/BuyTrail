/**
 * pnpm live:sweep [--status] [--max N] [--all] [--bootstrap] [--variant <id>]
 *
 * Explicit, bounded SerpApi sweep. Each searched variant costs one SerpApi credit.
 *  --status      print budget/usage and per-variant schedule; makes no API calls
 *  --max N       search at most N variants (default 1, hard limit 20)
 *  --all         include variants that aren't due yet
 *  --bootstrap   allow exceeding today's daily cap (still counted; the 30-day cap still applies)
 *  --variant ID  sweep exactly one tracked variant
 *  --debug       include up to 15 rejected result titles per variant (to tune title rules)
 * Never prints the API key or full provider payloads.
 */
import "./_env";
import { loadConfig } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { systemClock } from "@buytrail/domain";
import { LIVE_VARIANT_BY_ID } from "@buytrail/providers";
import { createS3Store, liveProvider, liveSweepStatus, seedLiveCatalog, sweepDueLiveVariants, sweepLiveVariant } from "@buytrail/services";

const arg = (name: string) => process.argv.includes(name);
const val = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const config = loadConfig();
  const db = getPrisma();
  if (!config.LIVE_PROVIDERS_ENABLED) throw new Error("LIVE_PROVIDERS_ENABLED is false; nothing to sweep");
  await seedLiveCatalog(db, config, systemClock.now());
  if (arg("--status")) {
    console.log(JSON.stringify(await liveSweepStatus(db, config, systemClock.now()), null, 2));
    return;
  }
  const provider = liveProvider(config, systemClock)!;
  const max = Math.min(20, Math.max(1, Number(val("--max") ?? 1) || 1));
  const variant = val("--variant");
  const storage = createS3Store(config);
  await storage.ensureBucket();
  const opts = { ignoreDailyCap: arg("--bootstrap"), debug: arg("--debug"), storage };
  const results = variant
    ? [await sweepLiveVariant(db, systemClock, config, provider, LIVE_VARIANT_BY_ID.get(variant) ?? (() => { throw new Error(`Unknown tracked variant ${variant}`); })(), opts)]
    : await sweepDueLiveVariants(db, systemClock, config, provider, { ...opts, max, all: arg("--all") });
  const status = await liveSweepStatus(db, config, systemClock.now());
  console.log(JSON.stringify({ results, used30d: status.used30d, monthlyBudget: status.monthlyBudget }, null, 2));
}

main()
  .catch((e) => {
    console.error(`live:sweep failed: ${e.message}`);
    process.exitCode = 1;
  })
  .finally(() => getPrisma().$disconnect());
