import { loadConfig } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { systemClock } from "@buytrail/domain";
import { createMailer, createS3Store, demoProviders, jsonLogger, type Services } from "@buytrail/services";
import { startWorker } from "./runtime";

export function buildServices(): Services {
  const config = loadConfig();
  const db = getPrisma();
  const clock = systemClock;
  return {
    db,
    config,
    clock,
    mailer: createMailer(config),
    storage: createS3Store(config),
    // Only demo providers exist; no live source is approved (docs/source-capabilities.md).
    providers: config.APP_MODE === "live" ? new Map() : demoProviders(clock, db),
    log: jsonLogger("worker"),
  };
}

async function main() {
  const s = buildServices();
  await s.storage.ensureBucket();
  const rt = await startWorker(s, {
    redisUrl: s.config.REDIS_URL,
    // Demo feed emulation: refresh every demo listing every 10 minutes.
    demoRefreshMs: s.config.APP_MODE === "demo" ? 10 * 60_000 : null,
  });
  const shutdown = async (sig: string) => {
    s.log.info("shutdown requested", { signal: sig });
    await rt.stop();
    await s.db.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(JSON.stringify({ level: "error", component: "worker", msg: "fatal", error: String(e?.message ?? e) }));
  process.exit(1);
});
