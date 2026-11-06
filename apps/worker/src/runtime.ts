/**
 * Worker runtime: a single BullMQ queue carrying outbox IDs, a relay/reconciler loop, a
 * scheduler loop for due work stored in PostgreSQL, and a heartbeat. Redis holds only IDs; it
 * can be cleared and rebuilt from PostgreSQL at any time (G17).
 */
import { hostname } from "node:os";
import { Queue, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import {
  expireExports,
  handleOutbox,
  liveProvider,
  processDeletionTasks,
  processDueReminders,
  purgeExpiredIdempotency,
  reconcileDeliveries,
  refreshAllDemo,
  relayOutbox,
  RetryLater,
  scheduleDueRefreshes,
  sweepDueLiveVariants,
  sweepExpiredQuotes,
  syncRefreshSchedules,
  type Services,
} from "@buytrail/services";

export const QUEUE_NAME = "buytrail-work";

export type WorkerRuntime = {
  stop(): Promise<void>;
  /** Run one scheduler + relay pass synchronously (tests, doctor). */
  tick(): Promise<TickReport>;
};

export type TickReport = {
  sweptExpired: number;
  reminders: { sent: number; cancelled: number };
  refreshesScheduled: number;
  deliveriesReconciled: number;
  deletions: number;
  relay: { published: number; reconciled: number };
};

export type WorkerOptions = {
  redisUrl: string;
  concurrency?: number;
  tickMs?: number;
  /** Demo only: periodically refresh every demo listing to emulate a feed. */
  demoRefreshMs?: number | null;
  /** Live source sweep check interval (null disables). Each check sweeps at most one due variant. */
  liveSweepMs?: number | null;
  workerId?: string;
};

export async function startWorker(s: Services, opts: WorkerOptions): Promise<WorkerRuntime> {
  const workerId = opts.workerId ?? `${hostname()}:${process.pid}`;
  const connection = new Redis(opts.redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUE_NAME, { connection });
  const startedAt = s.clock.now();
  let stopping = false;
  let lastTick: TickReport | null = null;

  const publish = async (job: { name: string; outboxId: string; jobId: string }) => {
    await queue.add(job.name, { outboxId: job.outboxId }, { jobId: job.jobId, removeOnComplete: 1000, removeOnFail: 1000, attempts: 1 });
  };

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<{ outboxId: string }>) => {
      try {
        return await handleOutbox(s, job.data.outboxId);
      } catch (e) {
        if (e instanceof RetryLater) return "retry_later";
        throw e;
      }
    },
    { connection: new Redis(opts.redisUrl, { maxRetriesPerRequest: null }), concurrency: opts.concurrency ?? 4, autorun: true },
  );
  worker.on("failed", (job, err) => s.log.error("job failed", { jobId: job?.id, error: err.message }));

  const tick = async (): Promise<TickReport> => {
    const now = s.clock.now();
    const sweptExpired = await sweepExpiredQuotes(s.db, s.clock);
    const reminders = await processDueReminders(s.db, now);
    const refreshesScheduled = await scheduleDueRefreshes(s.db, now);
    const deliveriesReconciled = await reconcileDeliveries(s.db, s.clock);
    const deletions = await processDeletionTasks(s.db, s.storage, now);
    await expireExports(s.db, now);
    await purgeExpiredIdempotency(s.db, now);
    const relay = await relayOutbox(s.db, s.clock, publish);
    lastTick = { sweptExpired, reminders, refreshesScheduled, deliveriesReconciled, deletions, relay };
    return lastTick;
  };

  const beat = async () => {
    const now = s.clock.now();
    await s.db.workerHeartbeat.upsert({
      where: { workerId },
      create: { workerId, startedAt, lastBeatAt: now, info: { mode: s.config.APP_MODE } },
      update: { lastBeatAt: now, info: { mode: s.config.APP_MODE, lastTick: lastTick as unknown as object } },
    });
  };

  // Loops. Each catches its own errors so one failing step never stops the worker.
  const loops: NodeJS.Timeout[] = [];
  const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
    let running = false;
    const t = setInterval(async () => {
      if (stopping || running) return;
      running = true;
      try {
        await fn();
      } catch (e) {
        s.log.error(`${name} failed`, { error: (e as Error).message });
      } finally {
        running = false;
      }
    }, ms);
    loops.push(t);
  };
  await beat();
  await syncRefreshSchedules(s.db, s.clock.now(), { watchedSeconds: 15 * 60, idleSeconds: 4 * 3600 }).catch((e) => s.log.warn("schedule sync failed", { error: (e as Error).message }));
  every(opts.tickMs ?? 2000, "tick", tick);
  every(10_000, "heartbeat", beat);
  every(5 * 60_000, "schedule-sync", () => syncRefreshSchedules(s.db, s.clock.now(), { watchedSeconds: 15 * 60, idleSeconds: 4 * 3600 }));
  if (opts.demoRefreshMs && s.config.APP_MODE === "demo") every(opts.demoRefreshMs, "demo-refresh", () => refreshAllDemo(s.db, s.clock));
  const live = liveProvider(s.config, s.clock);
  if (live && opts.liveSweepMs) {
    // One due variant per check, spreading searches out; budgets are enforced before each call.
    every(opts.liveSweepMs, "live-sweep", () => sweepDueLiveVariants(s.db, s.clock, s.config, live, { max: 1, log: s.log, storage: s.storage }));
  }

  s.log.info("worker started", { workerId, mode: s.config.APP_MODE });

  return {
    tick,
    async stop() {
      // Stop claiming new work; let in-flight jobs finish; unfinished leases expire and are reconciled.
      stopping = true;
      for (const t of loops) clearInterval(t);
      await worker.close();
      await queue.close();
      await connection.quit();
      s.log.info("worker stopped", { workerId });
    },
  };
}
