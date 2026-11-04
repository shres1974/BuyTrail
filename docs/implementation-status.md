# Implementation status

**Operating level: D0 — interactive demonstration with sample data.** No live or sandbox source is connected or approved (see `docs/source-capabilities.md`).

Last verified: 2026-11-04 on Linux (WSL), Node 24.22.2, pnpm 10.28.1, Docker Compose with Postgres 17, Redis 7.4, Mailpit 1.21, SeaweedFS 3.80.

## Verification commands and observed results

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ok |
| `pnpm db:migrate` | 3 migrations applied (init, constraints, generations) |
| `pnpm seed:demo` | 15 products, 31 variants, 101 listings, 2,148 observations over 21 days (first run ~54 s; reruns add one fresh check) |
| `pnpm doctor` | all required checks pass; worker heartbeat alive while the worker runs |
| `pnpm typecheck` | 0 errors (all packages + scripts) |
| `pnpm lint` | 0 errors, 0 warnings |
| `pnpm build` | ok (Next.js 16.4.5 production build) |
| `pnpm test:unit` | 6 files, 72 tests passed |
| `pnpm test:integration` | 4 files, 92 tests passed (real Postgres `buytrail_test`, real Redis DB 5 for the worker test) |
| `pnpm test:e2e` (web + worker running) | 9 passed (7 desktop Chromium, 2 Pixel 7 mobile) |
| `pnpm match:benchmark` | 373 cases, 0 false merges, 0 missed |
| `pnpm bench` (300 s @ 20 rps) | p95 13.8 ms overall, 0 errors, on the small demo dataset (see benchmarks.md) |

## Milestones

| Milestone | Status | Notes |
| --- | --- | --- |
| M0 Foundation | Done | Pinned stack, compose, validated config, doctor, ADRs, source investigation (eBay: approval required, not applied; Google Merchant: not applicable). |
| M1 Domain + fixtures | Done | G01–G09 pass in unit and DB-backed integration tests; zero wrong auto-matches across the demo catalog. |
| M2 Search + comparison demo | Done | DB-backed search (FTS + trigram + exact model/GTIN), filters, signed cursors, variant deep links, back/forward, incomplete/stale/other groups, history with gaps and honest coverage, sample labels, mobile cards, keyboard path. |
| M3 Accounts + watches | Done | Better Auth magic link (real flow via Mailpit in E2E), ownership checks, idempotent create, version conflicts, Section 28.1 sequence through the real pipeline, concurrency (G13). |
| M4 Approved live source | **Blocked** | No approved source. The CSV-feed adapter and admin import are implemented and contract-tested, and refuse unapproved sources. Owner decision needed on applying for eBay Buy API access or arranging a retailer feed. |
| M5 Workers + email | Done | Outbox, relay/reconciler, leases, Redis-flush recovery (real Redis), cooldown with send-time revalidation, ambiguous-outcome policy, per-user/global limits. G10–G19 pass. |
| M6 Purchases + receipts | Done | Manual and linked purchases, DST-aware deadlines, generation reschedule, cancellation paths, upload intents + quarantine + validation + previews + streaming download, deletion workflow, export, tombstones. G20–G24, G30 pass. Real uploads remain disabled in demo. |
| M7 Pilot hardening | Partial | Done: benchmark method + small-dataset results, export/deletion, keyboard/mobile checks, security doc. Not done: backup/restore drill, 10k-variant benchmark, formal accessibility review (axe/screen reader), user pilot, deployment. |
| M8 Extensions | Not started | Requires pilot evidence. |

## Golden scenarios

| ID | Status | Where |
| --- | --- | --- |
| G01–G03, G06, G08, G09 | Pass | domain `eligibility.test.ts`, `catalog.int.test.ts`, E2E |
| G04, G05, G07 | Pass | `matching.test.ts`, `catalog.int.test.ts`, `match:benchmark` |
| G10, G14, G15, G16 | Pass | `watches.int.test.ts` (ingestion) |
| G11, G12, G13, G19, G26, G27, G28 | Pass | `watches.int.test.ts`; G12/G26/G27 also E2E |
| G17 | Pass | `watches.int.test.ts` + `apps/worker/test/runtime.int.test.ts` (real Redis flush) |
| G18 | Pass | ambiguous send and crash-after-send-started paths |
| G20–G24, G30 | Pass | `private.int.test.ts`; G21/G30 also E2E |
| G25, G29 | Pass | `catalog.int.test.ts` |

## Known limitations / next work
1. **Live data is gated** (M4). Smallest next step: an owner decision on a source, then a capability record and an adapter behind `CatalogProvider`.
2. Daily `pg_dump` backups in the production compose file (same server); no restore drill yet.
3. Rate limiting is per process (ADR 0005).
4. The PDF scanner is heuristic; real uploads in live mode need a real scanner.
5. No purge jobs for `watch_evaluation`, completed `outbox_event` rows, or expired observations (`retainUntil` is stored but not yet swept).
6. Benchmarks used the small demo dataset only.
7. Accessibility: semantic markup, labels, focus styles, skip link, table alternatives, a keyboard E2E path and mobile E2E are in place. No automated axe scan or screen-reader pass yet. This is not WCAG certification.
8. No email bounce/delivery webhooks; "accepted" means accepted by SMTP only.
9. Private (postal-code) quote contexts are modelled and access-checked, but no UI creates them and the demo provider quotes only the national context.
10. The household, receipt-extraction, natural-language and replenishment features are deliberately deferred.

## Deployment
`Dockerfile` + `infra/compose.prod.yaml` (web, worker, Postgres, Redis, SeaweedFS, Caddy, migrate+seed, daily backup), tested locally on 2026-11-04 with `SITE_DOMAIN=localhost`. Verified: HTTPS and the HTTP→HTTPS redirect; HSTS and security headers; health showing database and worker alive; magic-link sign-in over SMTP with a Secure+HttpOnly session cookie; admin access through `ADMIN_EMAILS`; a non-allowlisted address gets no email; a backup file is written. Not yet deployed to a public server. Guide: `docs/deploy.md`.

## CI/CD
- `.github/workflows/ci.yml` runs on every push and pull request. Jobs: typecheck + lint + unit + match benchmark; integration against real Postgres/Redis/Mailpit/SeaweedFS started from `infra/compose.yaml`; Playwright E2E against a production build plus the worker; a production Docker image build and a compose-file check.
- All actions are pinned to commit SHAs, and the workflow uses no secrets.
- Validated locally with actionlint 1.7.7: no findings.
- Checks were run locally with only the CI environment variables: typecheck, 72 unit, 92 integration, 0 false merges.
- The first real run on GitHub is pending the push.
- `.github/workflows/deploy.yml` deploys over SSH (with a pinned host key) after CI passes, then waits for health. It is off until `DEPLOY_ENABLED=true` is set (see deploy.md).

## Session log
- Session 1 (previous agent): workspace, pinned deps, compose, config, Prisma schema + init migration, domain package (52 tests).
- Session 2 (this one): constraints and generations migrations, db client, providers (demo + CSV), services, worker, web UI/API, scripts, integration and E2E tests, benchmarks, docs.
