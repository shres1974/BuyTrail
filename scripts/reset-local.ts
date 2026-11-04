/**
 * pnpm db:reset:local — DESTRUCTIVE local reset: drops all data in the configured database and
 * reapplies migrations. Requires APP_MODE=demo|local, a localhost database, and --yes.
 */
import "./_env";
import { execSync } from "node:child_process";
import path from "node:path";
import { loadConfig } from "@buytrail/config";

const config = loadConfig();
const url = new URL(config.DATABASE_URL);
if (config.APP_MODE === "live") {
  console.error("Refusing: db:reset:local never runs in live mode.");
  process.exit(1);
}
if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
  console.error(`Refusing: database host ${url.hostname} is not local.`);
  process.exit(1);
}
if (!process.argv.includes("--yes")) {
  console.error(`This deletes ALL data in database "${url.pathname.slice(1)}" on ${url.hostname}. Re-run with: pnpm db:reset:local --yes`);
  process.exit(1);
}
execSync("pnpm --filter @buytrail/db exec prisma migrate reset --force", { cwd: path.resolve(import.meta.dirname, ".."), stdio: "inherit" });
console.log("Local database reset. Run pnpm seed:demo next.");
