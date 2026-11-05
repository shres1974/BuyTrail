# BuyTrail

A Canada-first shopping comparison and purchase companion. Pick the exact product variant, compare offers by **known total before tax**, set a target-price watch, then keep the purchase, a private receipt and a confirmed return-date reminder in one notebook. Retailers handle checkout.

> **Status: D0 — interactive demonstration.** The sample catalog (brands, stores, prices, history, alerts) is fictional and labelled "Sample data". Optionally, 15 real products get live Google Shopping prices via SerpApi, labelled "Live price"; see [docs/source-capabilities.md](docs/source-capabilities.md).

## What works
- Search covers a demo catalog of headphones, monitors and small appliances. It supports exact model/GTIN lookup, full-text and trigram search, filters, and stable pagination.
- Selecting an exact variant drives the comparison:
  - Ranked eligible offers, with a deterministic explanation of why the top offer wins.
  - Separate groups for *total not confirmed* (unknown shipping/fees), *stale*, and *not compared* (out of stock, conditional price, other currency, pending anomaly).
  - Price history with honest coverage ("Lowest observed since …") and a table alternative.
- Target-price watches use hysteresis rearming, at most one price email per 24 h, revalidation before every send, and durable in-app alerts.
- Purchases are recorded manually or from a variant. Return dates are confirmed by the user, timezone-aware, with reminders 3 days and 1 day before. Synthetic sample receipts go through the real validation pipeline.
- Accounts: magic-link sign-in, settings, export, and durable deletion. A small admin area shows source health and the match review queue.

## Quick start
Requirements: Node 24.x (`.nvmrc`), pnpm 10 via corepack, and Docker.

```bash
corepack enable
pnpm install --frozen-lockfile
cp .env.example .env            # then set AUTH_SECRET to a random value: openssl rand -hex 32
docker compose -f infra/compose.yaml up -d
pnpm db:migrate
pnpm seed:demo
pnpm doctor
pnpm dev                        # web on :3000 and worker together
```

Open http://localhost:3000. To sign in, enter any email; the link arrives in Mailpit at http://localhost:8025. `admin@buytrail.local` becomes an administrator locally (`ADMIN_EMAILS`).

To demo a price alert:
1. Open a product, choose a variant, and save a watch below the current best.
2. Use **Simulate a sample price change** to move one sample listing's price.
3. Check **Alerts** and Mailpit.

## Deploying the demo
See [docs/deploy.md](docs/deploy.md): one Linux server, `docker compose -f infra/compose.prod.yaml up -d --build`, automatic HTTPS via Caddy. Sign-in is restricted to `SIGNIN_ALLOWLIST`.

## Commands
| Command | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm dev:web` / `pnpm dev:worker` | Development servers |
| `pnpm build`, `pnpm start:web`, `pnpm worker` | Production web and worker |
| `pnpm lint`, `pnpm typecheck` | Static checks |
| `pnpm test:unit` | Domain, config and provider tests (no services needed) |
| `pnpm test:integration` | Real Postgres (`buytrail_test`) and Redis |
| `pnpm test:e2e` | Playwright against a running web + worker (`npx playwright install chromium` once) |
| `pnpm db:migrate`, `pnpm seed:demo` | Schema; rerunnable demo seed (never truncates) |
| `pnpm db:reset:local --yes` | **Destructive** local reset; refuses live mode and non-local hosts |
| `pnpm doctor` | Dependency and configuration checks (no secrets printed) |
| `pnpm source:probe <id>` | Bounded read-only source check |
| `pnpm live:sweep --status` / `--max N` | Live SerpApi prices: usage (no calls) / sweep up to N due products (1 credit each) |
| `pnpm admin:grant <email>` | Grant admin (audited) |
| `pnpm bench`, `pnpm match:benchmark` | Measured API latency; labelled matching benchmark |

## Layout
```
apps/web        Next.js App Router: pages, route handlers, Better Auth
apps/worker     BullMQ consumer, outbox relay/reconciler, schedulers, heartbeat
packages/domain Pure rules: money, matching, eligibility, watches, reminders
packages/db     Prisma schema + SQL migrations (constraints, search, generations)
packages/providers  Provider contract, demo provider, authorized CSV feed parser
packages/services   Application services shared by web and worker
packages/config Validated environment
infra/          Docker Compose for local dependencies
scripts/        seed, doctor, probe, reset, bench, admin-grant
docs/           architecture, status, sources, data dictionary, security, ops, benchmarks, ADRs
```

## Documentation
- [Deployment guide](docs/deploy.md)
- [Implementation status](docs/implementation-status.md): what is verified, blocked or deferred
- [Architecture](docs/architecture.md) · [Security model](docs/security-model.md) · [Operations](docs/operations.md)
- [Data dictionary](docs/data-dictionary.md) · [Benchmarks](docs/benchmarks.md) · [Decisions](docs/decisions/)

BuyTrail is a provisional name. Check naming and domain availability before any public branding.
