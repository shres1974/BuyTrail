/**
 * Shared integration-test kit: real PostgreSQL (buytrail_test), fake clock, in-memory object
 * store, recording mailer. Each test file resets the database with TRUNCATE (test DB only).
 */
import { parseConfig, type AppConfig } from "@buytrail/config";
import { createPrisma, type Db } from "@buytrail/db";
import { FakeClock } from "@buytrail/domain";
import {
  createMemoryStore,
  demoProviders,
  seedDemoCatalog,
  silentLogger,
  type Actor,
  type Mailer,
  type OutgoingEmail,
  type Services,
  SendError,
  handleOutbox,
} from "../src";

export const T0 = new Date("2026-11-04T15:00:00Z");

export function testConfig(over: Record<string, string> = {}): AppConfig {
  return parseConfig({
    APP_MODE: "local",
    DATABASE_URL: process.env.DATABASE_URL!,
    AUTH_SECRET: "test_secret_test_secret_test_secret",
    OBJECT_STORAGE_ACCESS_KEY: "x",
    OBJECT_STORAGE_SECRET_KEY: "y",
    EMAIL_MODE: "local",
    ...over,
  });
}

export type RecordingMailer = Mailer & {
  sent: OutgoingEmail[];
  /** Behaviour of the next send: ok | ambiguous | refused | permanent. */
  next: Array<"ok" | "ambiguous" | "refused" | "permanent" | "crash_after_accept">;
  accepted: Set<string>;
};

export function recordingMailer(): RecordingMailer {
  const m: RecordingMailer = {
    mode: "local",
    sent: [],
    next: [],
    accepted: new Set(),
    async send(email) {
      const mode = m.next.shift() ?? "ok";
      if (mode === "refused") throw new SendError("not_sent_retryable", "ECONNREFUSED");
      if (mode === "permanent") throw new SendError("permanent", "550 mailbox unavailable");
      m.sent.push(email);
      m.accepted.add(email.idempotencyKey);
      if (mode === "ambiguous") throw new SendError("ambiguous", "socket timeout after DATA");
      if (mode === "crash_after_accept") throw new Error("SIMULATED_CRASH");
      return { providerMessageId: `<${email.idempotencyKey}@test>` };
    },
    async lookup() {
      return null; // no reconciliation available by default
    },
  };
  return m;
}

export async function resetDb(db: Db) {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const dbName = await db.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`;
  if (!dbName[0]!.current_database.endsWith("_test")) throw new Error("refusing to truncate a non-test database");
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export type Kit = Services & { clock: FakeClock; mailer: RecordingMailer; storage: ReturnType<typeof createMemoryStore> };

let shared: Db | null = null;
export function testDb(): Db {
  if (!shared) shared = createPrisma(process.env.DATABASE_URL!, { max: 8 });
  return shared;
}

export async function makeKit(over: Record<string, string> = {}): Promise<Kit> {
  const db = testDb();
  const clock = new FakeClock(T0);
  return {
    db,
    clock,
    config: testConfig(over),
    mailer: recordingMailer(),
    storage: createMemoryStore(),
    providers: demoProviders(clock, db),
    log: silentLogger,
  };
}

export async function seeded(over: Record<string, string> = {}): Promise<Kit> {
  const k = await makeKit(over);
  await resetDb(k.db);
  await seedDemoCatalog(k.db);
  return k;
}

let userSeq = 0;
export async function makeUser(db: Db, over: { email?: string; role?: string; timezone?: string } = {}): Promise<Actor> {
  userSeq++;
  const id = `user_test_${userSeq}_${Math.random().toString(36).slice(2, 8)}`;
  const email = over.email ?? `${id}@example.test`;
  const u = await db.user.create({ data: { id, name: id, email, emailVerified: true, role: over.role ?? "user", timezone: over.timezone ?? "America/Toronto" } });
  return { id: u.id, email: u.email, role: u.role as "user", timezone: u.timezone };
}

/** Drain all due outbox work synchronously, like a worker would (bounded passes). */
export async function drainOutbox(k: Kit, maxPasses = 20): Promise<string[]> {
  const results: string[] = [];
  for (let i = 0; i < maxPasses; i++) {
    const due = await k.db.outboxEvent.findMany({ where: { completedAt: null, availableAt: { lte: k.clock.now() } }, orderBy: { createdAt: "asc" } });
    if (!due.length) break;
    for (const d of due) results.push(`${d.type}:${await handleOutbox(k, d.id)}`);
  }
  return results;
}
