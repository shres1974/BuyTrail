import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/prisma/client";

export { Prisma, PrismaClient };
export type * from "./generated/prisma/client";

export type Db = PrismaClient;
/** Interactive transaction client. */
export type Tx = Prisma.TransactionClient;
export type DbOrTx = Db | Tx;

export function createPrisma(connectionString: string, opts: { max?: number } = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts.max ?? 10 });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __buytrailPrisma?: PrismaClient };

/** Process-wide client (survives Next.js dev hot reloads). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__buytrailPrisma) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    globalForPrisma.__buytrailPrisma = createPrisma(url);
  }
  return globalForPrisma.__buytrailPrisma;
}

/**
 * Run fn in a transaction, retrying bounded times on serialization failures and deadlocks
 * (SQLSTATE 40001 / 40P01). Section 17.
 */
export async function withTx<T>(
  db: PrismaClient,
  fn: (tx: Tx) => Promise<T>,
  opts: { isolationLevel?: Prisma.TransactionIsolationLevel; retries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        isolationLevel: opts.isolationLevel ?? Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: opts.timeoutMs ?? 15_000,
        maxWait: 10_000,
      });
    } catch (e) {
      if (attempt < retries && isRetryableTxError(e)) {
        await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 20));
        continue;
      }
      throw e;
    }
  }
}

export function isRetryableTxError(e: unknown): boolean {
  const s = String((e as { message?: string })?.message ?? e);
  const code = (e as { code?: string })?.code;
  return code === "P2034" || /40001|40P01|could not serialize|deadlock detected/i.test(s);
}

export function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "P2002" || /23505|unique constraint/i.test(String((e as Error)?.message ?? ""));
}
