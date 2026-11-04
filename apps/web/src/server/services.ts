import { loadConfig } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { systemClock } from "@buytrail/domain";
import { createMailer, createS3Store, demoProviders, jsonLogger, type Services } from "@buytrail/services";

const g = globalThis as unknown as { __btServices?: Services };

/** Web-process service container. Config is validated on first use; invalid config fails fast. */
export function services(): Services {
  if (!g.__btServices) {
    const config = loadConfig();
    const db = getPrisma();
    g.__btServices = {
      db,
      config,
      clock: systemClock,
      mailer: createMailer(config),
      storage: createS3Store(config),
      providers: config.APP_MODE === "live" ? new Map() : demoProviders(systemClock, db),
      log: jsonLogger("web"),
    };
  }
  return g.__btServices;
}
