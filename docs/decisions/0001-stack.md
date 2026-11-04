# 0001 — Stack and versions

Status: accepted (2026-11-04)

These are the versions installed and pinned in `pnpm-lock.yaml` (with `save-exact`):
- Node 24.22.2 (`.nvmrc`; engines `>=24.11 <25`)
- pnpm 10.28.1
- TypeScript 5.9.3 (strict)
- Next.js 16.4.5 / React 19.3.1
- Tailwind 4.3.4
- Prisma 7.10.1 with `@prisma/adapter-pg` and pg 8.23.1
- Better Auth 1.7.16 (Prisma adapter, magic-link plugin)
- BullMQ 5.81.5 / ioredis 5.11.1
- Zod 4.6.7, Luxon 3.7.2
- nodemailer 7.0.13, `@aws-sdk/client-s3` 3.1161.0, sharp 0.35.5
- Vitest 4.1.12, Playwright 1.64.1

Each API was checked against the installed version:
- Prisma 7 generates a client into `packages/db/src/generated` (gitignored) and needs a driver adapter.
- Next 16 renames middleware to `proxy` (unused here) and makes route `params` a Promise.
- Better Auth's magic link supports `storeToken: "hashed"`.

Rejected: Drizzle (the spec recommends Prisma; both are viable), and a custom session implementation (the spec forbids it).
