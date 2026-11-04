/**
 * Readiness/health (Section 32.2). Public output contains no credentials, counts of accounts,
 * or infrastructure addresses.
 */
import type { Db } from "@buytrail/db";

export const WORKER_HEARTBEAT_STALE_MS = 60_000;

export async function workerStatus(db: Db, now: Date) {
  const beats = await db.workerHeartbeat.findMany({ orderBy: { lastBeatAt: "desc" }, take: 5 });
  const latest = beats[0];
  const alive = !!latest && now.getTime() - latest.lastBeatAt.getTime() < WORKER_HEARTBEAT_STALE_MS;
  return { alive, lastBeatAt: latest?.lastBeatAt.toISOString() ?? null, info: (latest?.info ?? {}) as Record<string, unknown> };
}

export async function readiness(db: Db, now: Date) {
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const worker = database ? await workerStatus(db, now) : { alive: false, lastBeatAt: null, info: {} };
  const sources = database ? await db.source.findMany({ select: { id: true, mode: true, status: true } }) : [];
  return {
    database,
    worker: { alive: worker.alive, lastBeatAt: worker.lastBeatAt },
    sources: sources.map((s) => ({ id: s.id, mode: s.mode, status: s.status })),
    // Reminders and email require a running worker; web alone is not "healthy" for them.
    remindersOperational: database && worker.alive,
  };
}
