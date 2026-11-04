# Operations

## Processes
- **web**: `pnpm build && pnpm start:web` (Next.js on :3000).
- **worker**: `pnpm worker`. It must run continuously; reminders, email, and watch evaluation depend on it.
- `/api/health` reports `remindersOperational: false` when no worker heartbeat has arrived in the last 60 s. The watchlist then shows a "background checks paused" notice.
- Shutdown: on SIGTERM the worker stops claiming work and closes BullMQ gracefully. Unfinished leases expire after 2 minutes and the reconciler picks them up.

## Local dependencies
- `docker compose -f infra/compose.yaml up -d` starts:
  - PostgreSQL 17 on :5432 (dev DB `buytrail` and test DB `buytrail_test`)
  - Redis 7.4 on :6379 (`noeviction`)
  - Mailpit (SMTP :1025, UI http://localhost:8025)
  - SeaweedFS S3 on :9000
- `pnpm doctor` checks:
  - config
  - migrations and `pg_trgm`
  - Redis and its eviction policy
  - object read/write and anonymous-access denial
  - SMTP
  - worker heartbeat
  - sources

## Configuration
- See `.env.example`. Live mode refuses local-only secrets, http base URLs, local email, uploads without a scanner, and AI flags.
- Limits are validated with ceilings:
  - `MAX_ACTIVE_WATCHES_PER_USER` 50
  - `RECEIPT_MAX_BYTES` 10 MiB
  - `RECEIPTS_PER_PURCHASE` 5
  - `ACCOUNT_STORAGE_QUOTA_BYTES` 100 MiB
  - `PRICE_ALERT_EMAIL_COOLDOWN_HOURS` 24
  - `EMAIL_USER_LIMIT_PER_DAY` 30
  - `EMAIL_GLOBAL_LIMIT_PER_HOUR` 500
  - `SEARCH_RATE_LIMIT_PER_MINUTE` 120
- `TRUST_PROXY=true` only behind a proxy that overwrites `X-Forwarded-For`.
- `EMAIL_TEST_ALLOWLIST` restricts recipients outside local mode.

## Source budgets
- Each provider call first reserves from `source_budget_day`, an atomic conditional increment. When the budget is exhausted, work is delayed until the next UTC day and the UI shows older "Checked …" ages.
- A 429 Retry-After is persisted in `source.nextEligibleRequestAt`, so restarts cannot flood a source.
- 5 consecutive failures open the circuit for 10 minutes.
- Refresh schedules exist per (listing, public context). Watched pairs refresh every 15 min and others every 4 h, but never faster than the source's minimum interval.
- Worked example (Section 31.1): 500 pairs × 6/day = 3,000 + 20% reserve = 3,600 requests/day. Set `dailyRequestBudget` from the provider's actual quota, not from this example.

## Backups and restore (not yet set up)
This repository contains no backup configuration. Before a live pilot:
1. Schedule `pg_dump -Fc` (or managed PITR) and enable bucket versioning plus lifecycle on the object store.
2. Run a restore drill into an isolated environment:
   - Restore the database **with workers stopped**.
   - Run `reconcileTombstones` (re-deletes accounts deleted after the backup was taken).
   - Run a reconcile pass: start the worker. Expired leases and lost dispatches are republished. Reminders whose generation changed are cancelled at processing time. Past-due reminders are sent once each (none are burst-sent for old generations).
3. Verify private object access (owner download, other user 404), schedules, and tombstones.

A backup that has never been restored is an unverified plan.

## Incident playbooks
| Incident | Action |
| --- | --- |
| Provider outage | Nothing manual: failures are recorded, the circuit opens, and quotes go stale and drop out of rankings and alerts. Watch `/admin` source health. |
| Redis loss | Restart Redis. The worker's relay republishes unfinished outbox rows after 60 s (tested: `apps/worker/test/runtime.int.test.ts`). |
| Worker crash | Restart it. Leases expire after 2 min. Generation checks stop stale results from overwriting newer ones. |
| Incorrect match | `/admin` → reject or re-link. Quotes are invalidated, generations bumped, watches re-evaluated, and queued price emails revalidate before sending. |
| Bad price import | Disable the source (`status='disabled'`). Its offers stop being displayable or eligible immediately. |
| Email provider outage | Definite non-sends retry with backoff; ambiguous ones become `unknown_outcome`. In-app alerts are unaffected. |
| Receipt processing failure | The file stays in quarantine (`processing`); retry by re-enqueueing `receipt.validate`, or delete it. |

## Cost worksheet
Fill this in from current quotes when deploying. No prices are assumed here:
- web runtime
- worker runtime
- PostgreSQL plus backups
- Redis
- object storage and egress
- email volume
- provider/API fees
- AI (disabled)
- monitoring
- domain
