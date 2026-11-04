/**
 * Worker runtime against real Redis + PostgreSQL: jobs flow through BullMQ, and a Redis
 * FLUSHALL after dispatch does not lose committed work (G17, R12).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { systemClock } from "@buytrail/domain";
import { createWatch, seedDemoListings, simulateDemoPrice, OUTBOX_LOST_AFTER_MS, demoProviders } from "@buytrail/services";
import { makeUser, seeded, type Kit } from "../../../packages/services/test/kit";
import { startWorker, type WorkerRuntime } from "../src/runtime";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Isolate from a dev worker by using a separate Redis logical DB.
const TEST_REDIS = REDIS_URL.replace(/\/\d*$/, "") + "/5";

let k: Kit;
let rt: WorkerRuntime;
let redis: Redis;

beforeAll(async () => {
  k = await seeded();
  // The runtime test uses the real clock: BullMQ and leases run in wall time.
  (k as unknown as { clock: typeof systemClock }).clock = systemClock;
  k.providers = demoProviders(systemClock, k.db);
  await seedDemoListings(k.db, systemClock, { historyDays: 0 });
  redis = new Redis(TEST_REDIS);
  await redis.flushdb();
  rt = await startWorker(k, { redisUrl: TEST_REDIS, tickMs: 200_000, workerId: "test-worker" });
}, 90_000);

afterAll(async () => {
  await rt?.stop();
  await redis?.quit();
});

async function until(fn: () => Promise<boolean>, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await rt.tick(); // relay newly created outbox rows (the interval loop is disabled in tests)
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

describe("worker runtime", () => {
  it("writes a heartbeat", async () => {
    const hb = await k.db.workerHeartbeat.findUnique({ where: { workerId: "test-worker" } });
    expect(hb).not.toBeNull();
  });

  it("processes a price crossing end-to-end through Redis and delivers one email", async () => {
    const u = await makeUser(k.db);
    await simulateDemoPrice(k.db, systemClock, "CE-310", 11000n);
    await createWatch(k.db, k.config, new Date(), u, { variantId: "var_demo_monitor_27_qhd", target: { amountMinor: "10000", currency: "CAD" }, channels: ["in_app", "email"] }, null);
    await simulateDemoPrice(k.db, systemClock, "CE-310", 9900n);
    await rt.tick();
    expect(await until(async () => k.mailer.sent.some((m) => m.text.includes("CAD 99.00")))).toBe(true);
    expect(await k.db.notificationEvent.count({ where: { userId: u.id } })).toBe(1);
  });

  it("G17: FLUSHALL after dispatch — the reconciler restores the work", async () => {
    const u = await makeUser(k.db);
    await simulateDemoPrice(k.db, systemClock, "CE-310", 11000n);
    await rt.tick();
    await createWatch(k.db, k.config, new Date(), u, { variantId: "var_demo_monitor_27_qhd", target: { amountMinor: "10000", currency: "CAD" } }, null);
    // Pause the BullMQ worker by stopping the runtime and publishing into a fresh queue we flush.
    await rt.stop();
    await simulateDemoPrice(k.db, systemClock, "CE-310", 9900n);
    const { relayOutbox } = await import("@buytrail/services");
    const { Queue } = await import("bullmq");
    const q = new Queue("buytrail-work", { connection: new Redis(TEST_REDIS, { maxRetriesPerRequest: null }) });
    const r = await relayOutbox(k.db, systemClock, async (j) => void (await q.add(j.name, { outboxId: j.outboxId }, { jobId: j.jobId })));
    expect(r.published).toBeGreaterThan(0);
    await q.close();
    await redis.flushdb(); // Redis loss: published jobs are gone
    // Restart a worker; make the "lost" window elapse by back-dating the dispatch.
    await k.db.outboxEvent.updateMany({ where: { completedAt: null, dispatchedAt: { not: null } }, data: { dispatchedAt: new Date(Date.now() - OUTBOX_LOST_AFTER_MS - 1000) } });
    rt = await startWorker(k, { redisUrl: TEST_REDIS, tickMs: 200_000, workerId: "test-worker" });
    const rep = await rt.tick();
    expect(rep.relay.reconciled).toBeGreaterThan(0);
    expect(await until(async () => (await k.db.notificationEvent.count({ where: { userId: u.id } })) === 1)).toBe(true);
    expect(await k.db.outboxEvent.count({ where: { completedAt: null, availableAt: { lte: new Date() } } })).toBe(0);
  });
});
