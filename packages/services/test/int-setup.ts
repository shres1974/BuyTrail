/**
 * Integration test setup: points DATABASE_URL at the isolated buytrail_test database and
 * applies migrations once. Tests never touch the development database.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { config as loadEnv } from "dotenv";

const root = path.resolve(import.meta.dirname, "../../..");
loadEnv({ path: path.join(root, ".env"), quiet: true });
const testUrl = process.env.TEST_DATABASE_URL ?? "postgresql://buytrail:local_only@localhost:5432/buytrail_test";
if (!/_test\b/.test(testUrl)) throw new Error("TEST_DATABASE_URL must point at a *_test database");
process.env.DATABASE_URL = testUrl;
process.env.APP_MODE = process.env.APP_MODE_TEST ?? "local";

const g = globalThis as unknown as { __btMigrated?: boolean };
if (!g.__btMigrated) {
  execSync("pnpm --silent --filter @buytrail/db migrate:deploy", { cwd: root, env: { ...process.env, DATABASE_URL: testUrl }, stdio: "pipe" });
  g.__btMigrated = true;
}
