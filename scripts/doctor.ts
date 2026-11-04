/**
 * pnpm doctor — checks dependencies and configuration without printing credentials.
 * Exit code 1 if any required check fails.
 */
import "./_env";
import { Redis } from "ioredis";
import nodemailer from "nodemailer";
import { loadConfig, redactedConfig, ConfigError } from "@buytrail/config";
import { getPrisma } from "@buytrail/db";
import { createS3Store, workerStatus, sourceHealth } from "@buytrail/services";

type Check = { name: string; ok: boolean; detail: string; required: boolean };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string, required = true) => checks.push({ name, ok, detail, required });

async function main() {
  let config;
  try {
    config = loadConfig();
    add("config", true, `APP_MODE=${config.APP_MODE}, EMAIL_MODE=${config.EMAIL_MODE}, LIVE_PROVIDERS_ENABLED=${config.LIVE_PROVIDERS_ENABLED}, REAL_RECEIPT_UPLOADS_ENABLED=${config.REAL_RECEIPT_UPLOADS_ENABLED}`);
  } catch (e) {
    add("config", false, e instanceof ConfigError ? e.problems.join("; ") : String(e));
    return;
  }
  const db = getPrisma();
  try {
    await db.$queryRaw`SELECT 1`;
    const applied = await db.$queryRaw<Array<{ migration_name: string }>>`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`;
    const fs = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(import.meta.dirname, "../packages/db/prisma/migrations");
    const expected = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort();
    const missing = expected.filter((m) => !applied.some((a) => a.migration_name === m));
    add("database.migrations", missing.length === 0, missing.length ? `pending: ${missing.join(", ")} — run pnpm db:migrate` : `${applied.length} applied`);
    const ext = await db.$queryRaw<Array<{ extname: string }>>`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'`;
    add("database.pg_trgm", ext.length === 1, ext.length ? "installed" : "missing");
    const products = await db.product.count();
    add("catalog", products > 0, products ? `${products} products` : "empty — run pnpm seed:demo", false);
  } catch (e) {
    add("database", false, `unreachable: ${(e as Error).message.split("\n")[0]}`);
  }
  try {
    const r = new Redis(config.REDIS_URL, { lazyConnect: true, connectTimeout: 3000, maxRetriesPerRequest: 1 });
    await r.connect();
    const pong = await r.ping();
    const policy = (await r.config("GET", "maxmemory-policy")) as string[];
    add("redis", pong === "PONG", `ping ok; maxmemory-policy=${policy[1]}`);
    if (policy[1] !== "noeviction") add("redis.eviction", false, "BullMQ requires maxmemory-policy=noeviction", false);
    await r.quit();
  } catch (e) {
    add("redis", false, `unreachable: ${(e as Error).message}`);
  }
  try {
    const store = createS3Store(config);
    await store.ensureBucket();
    const probeKey = `doctor/${Date.now()}`;
    await store.put(probeKey, Buffer.from("ok"), "text/plain");
    const back = await store.get(probeKey, 10);
    await store.delete(probeKey);
    add("objects.readwrite", back?.toString() === "ok", "authenticated put/get/delete ok");
    const priv = await store.privacy();
    add("objects.private", priv === "private", `bucket privacy: ${priv}`, config.APP_MODE === "live");
  } catch (e) {
    add("objects", false, `unavailable: ${(e as Error).message}`);
  }
  if (config.EMAIL_MODE === "disabled") add("email", true, "disabled (no external delivery)");
  else {
    try {
      const t = nodemailer.createTransport({ host: config.SMTP_HOST, port: config.SMTP_PORT, connectionTimeout: 3000 });
      await t.verify();
      add("email", true, `${config.EMAIL_MODE} SMTP reachable${config.EMAIL_MODE === "local" ? " (Mailpit UI: " + config.MAILPIT_API_URL + ")" : ""}`);
    } catch (e) {
      add("email", false, `SMTP unreachable: ${(e as Error).message}`);
    }
  }
  try {
    const w = await workerStatus(db, new Date());
    add("worker.heartbeat", w.alive, w.alive ? `alive (last beat ${w.lastBeatAt})` : w.lastBeatAt ? `stale (last beat ${w.lastBeatAt}) — reminders/email will not run` : "no worker has run — start pnpm dev:worker", false);
    const sources = await sourceHealth(db, new Date());
    for (const s of sources) add(`source.${s.id}`, s.status !== "disabled", `mode=${s.mode} approval=${s.approvalStatus} status=${s.status} lookup=${s.capabilities.lookup} history=${s.capabilities.historyAllowed}`, false);
    const live = sources.filter((s) => s.mode === "live" && s.approvalStatus === "approved");
    add("live.sources", true, live.length ? `${live.length} approved live source(s)` : "none approved — operating level D0 (demonstration). See docs/source-capabilities.md", false);
  } catch {
    /* database failure already reported */
  }
  await db.$disconnect();
  void redactedConfig;
}

main()
  .catch((e) => add("doctor", false, String(e?.message ?? e)))
  .finally(() => {
    for (const c of checks) console.log(`${c.ok ? "✔" : c.required ? "✘" : "!"} ${c.name.padEnd(22)} ${c.detail}`);
    const failed = checks.filter((c) => !c.ok && c.required);
    console.log(failed.length ? `\n${failed.length} required check(s) failed.` : "\nAll required checks passed.");
    process.exit(failed.length ? 1 : 0);
  });
