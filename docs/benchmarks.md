# Benchmarks

All numbers below are measured. Re-run them with `pnpm bench` against a running production build.

## API latency — 2026-11-04

**Method**
- `scripts/bench.ts` sends an open-loop load of 20 req/s for 300 s after a 30 s warmup.
- Request mix: 40% exact-model search, 30% category search, 30% variant offers.
- Target: the production Next.js server (`next start`) on the same machine as the client.

**Environment**
- Intel Core Ultra 5 135H (18 logical CPUs), 7.8 GiB RAM, Linux (WSL), Node 24.22.2.
- PostgreSQL 17 and Redis 7.4 in Docker on the same host. The worker was running during the test.

**Dataset**: the demo catalog. 15 products, 31 variants, 101 listings, 101 current offers, ~2,150 observations.

This is **far smaller** than the spec's target dataset (10,000 variants / 30,000 offers), so these results do not show that the spec's targets are met at that scale.

**Rate limit**: search was raised to 10,000/min for the run (`BENCH=1`).

| Kind | n | errors | p50 ms | p95 ms | p99 ms |
| --- | --- | --- | --- | --- | --- |
| search (exact model) | 2,401 | 0 | 9.6 | 14.0 | 21.7 |
| search (category) | 1,800 | 0 | 10.5 | 15.1 | 25.5 |
| variant offers | 1,800 | 0 | 7.9 | 11.2 | 17.1 |
| **all** | 6,001 | 0 | 9.4 | 13.8 | 21.7 |

First request after a server restart: 70 ms.

## Matching benchmark — 2026-11-04

`pnpm match:benchmark` ran 373 labelled synthetic cases derived from the demo catalog: 124 should-match and 249 should-not-match. The negatives include model suffixes, bad check digits, conflicting critical attributes, missing attributes, another brand, and another variant's GTIN.

Result: **0 false automatic merges, 0 missed matches** (rule `match-v1`). This covers the synthetic set only and does not extrapolate to real feeds.

## Not yet measured
- The 10,000-variant / 30,000-offer dataset (needs a synthetic generator).
- End-to-end latency from observation to event, and from event to email (the E2E journey shows it works within a few seconds locally, but it was not instrumented).
- Reminder lateness.
- Cold-cache behaviour under load.
