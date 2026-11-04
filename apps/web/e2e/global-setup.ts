/**
 * Reset scripted demo prices before the suite so golden comparisons (G01) hold. Uses the
 * database directly via the services package; only demo overrides are touched.
 */
import path from "node:path";
import { config } from "dotenv";

export default async function globalSetup() {
  config({ path: path.resolve(import.meta.dirname, "../../../.env"), quiet: true });
  const { getPrisma } = await import("@buytrail/db");
  const { refreshAllDemo } = await import("@buytrail/services");
  const { systemClock } = await import("@buytrail/domain");
  const db = getPrisma();
  await db.demoPriceOverride.deleteMany({});
  await refreshAllDemo(db, systemClock);
  await db.$disconnect();
}
