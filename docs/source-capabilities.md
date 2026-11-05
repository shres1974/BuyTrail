# Source capabilities

Unknown permission means the capability stays disabled (Section 9.1). Operating level: **D0 (demonstration)**. The public demo is *mixed*: the fictional sample catalog stays, and one live price source can be enabled next to it. Every record is labelled by origin ("Sample data" or "Live price · Google Shopping").

## Active sources

### `serpapi-google-shopping` (live, owner-approved for the demonstration)

| Field | Value |
| --- | --- |
| Owner / market | SerpApi (Google Shopping results) / CA (`gl=ca`, `google.ca`, location Toronto) |
| Integration type | HTTPS JSON API, `engine=google_shopping` (`packages/providers/src/serpapi.ts`) |
| Approval status | `approved` by the project owner on 2026-11-05 for a non-commercial portfolio demonstration. The owner is responsible for compliance with SerpApi's terms of service and for how Google Shopping data is displayed and retained. |
| Credentials | `SERPAPI_API_KEY` in `.env.production` on the server only (mode 600). It's never committed, logged or included in errors. |
| Enabled by | `LIVE_PROVIDERS_ENABLED=true` (config refuses to start without a key) |
| Catalog | 15 curated real products, one variant each (`packages/providers/src/live-catalog.ts`). Visitor searches only query the stored catalog and never call SerpApi. |
| Matching | A result belongs to a variant only if its title passes the variant's explicit rules (model code and, where relevant, size/edition required; other colours, generations, accessories, multi-packs and bundles rejected). One listing per seller + condition, lowest price kept. |
| Data policy | Listed results count as **in stock** unless marked otherwise. Shipping is **known** only when stated ("Free delivery", "$9.99 delivery"); "free over $X" is a threshold; otherwise **unknown** (never zero). **Fees: none** (Google Shopping lists the seller's price). Instalment prices (`/mo`) and non-CAD/USD prices are skipped; USD is shown but not ranked. Condition from title/labels (refurbished/renewed, used/open box). |
| Quotas | Free plan: 250 searches/month. Hard caps enforced before every call: `SERPAPI_DAILY_BUDGET` (default 6) via the atomic `source_budget_day` counter, and `SERPAPI_MONTHLY_BUDGET` (default 200) over a rolling 30 days. Refresh interval `SERPAPI_REFRESH_HOURS` (default 72) ≈ 150 searches/month for 15 products. |
| Refresh | Worker checks every 30 min and sweeps at most one due variant. No per-listing lookups (`lookup: false`), and watches, alerts and pre-send revalidation use stored quotes only. |
| Freshness | Refresh interval + 24 h. Older prices move to "Not recently confirmed" and stop counting for alerts. |
| History | Allowed (owner decision); retention 180 days. |
| Images | Not displayed (`imageDisplayAllowed: false`). |
| Outbound links | Seller link from the result when present, else the Google Shopping product page (`https` only). |
| Failure handling | 401/invalid key → `invalid_credentials` (sweeps stop); 429/out of searches → `quota_exhausted` (24 h back-off); 5xx/network → retry after 6 h. A failure never changes stored prices. |
| Known blind spots | Stock, fees and shipping are as reported by Google Shopping, not checkout quotes. Seller names come from Google Shopping. Sellers that don't appear in a given search keep their last price until it goes stale. |

Operator commands (each searched variant costs one credit):
```bash
pnpm live:sweep --status                 # usage and schedule, no API calls
pnpm live:sweep --max 3                  # sweep up to 3 due variants
pnpm live:sweep --all --max 15 --bootstrap   # first fill; exceeds today's cap, still bounded by the 30-day cap
```

### `demo-retail-feed`, `demo-marketplace-feed` (demonstration)

| Field | Value |
| --- | --- |
| Owner / market | BuyTrail project / CA |
| Integration type | In-process deterministic provider (`packages/providers/src/demo-provider.ts`) |
| Approval status | `demo` — synthetic data, no external permission involved |
| Credentials | None |
| Allowed fields | Search, lookup, price, stock, shipping (known / unknown / threshold), fees, GTIN, model, attributes, condition |
| Seller-specific conditions/variants | Yes (new/refurbished; bundles, colours, capacities as distinct variants) |
| Quotas | Daily budget 20,000 (configurable on the `source` row), minimum refresh 60 s, batch 50 |
| Display/attribution | Every record is labelled "Sample data". Store domains use the reserved `.example` TLD; GTINs use the GS1 restricted-circulation prefix `2`. |
| Caching / history | Allowed; retention 180 days (`historyRetentionDays`) |
| Images | Not provided (`imageDisplayAllowed: false`); UI shows a placeholder |
| Affiliate parameters | None |
| Known blind spots | Fictional catalog only: 15 products, 31 variants, 101 listings |

## Investigated live options

Checked on 2026-11-04 by the implementing agent with read-only fetches of the public documentation pages listed. No account, credential, or API call was used. **Nothing below is an approval.**

### eBay Browse API (S02–S04): candidate, not approved

- The marketplace support page lists `EBAY_CA - Canada (ebay.ca)`.
- The Buy API requirements page says production use requires an application/approval process and advises obtaining approval "before you invest significantly in application development." Some Buy APIs are beta. The checkout use cases need separate approval through Developer Technical Support.
- Still to verify before any work starts: whether the intended use (price comparison display plus a retained price history) is permitted; rate limits for the granted tier; caching and retention limits per field; attribution and outbound link rules; whether affiliate (EPN) parameters are required; and whether item condition and shipping-to-destination fields are reliable for CA.
- Status: **unavailable (no application submitted)**. Submitting one is an external commitment, so it needs the owner's decision.

### Google Merchant API (S01): not applicable for discovery

- The API manages resources of Merchant Center accounts you are authorized for. It is not a search API over Google Shopping. It would help only if a specific merchant granted access to its own catalog.

### Authorized retailer CSV feed: supported path, no partner yet

- `packages/providers/src/csv-feed.ts` implements a strict, bounded parser: exact header set, 2 MiB / 5,000 rows, host-allowlisted outbound URLs, exact money, and unknown fees stay unknown. The admin `POST /api/admin/imports` refuses any source whose `approvalStatus` is not `approved`.
- To onboard one: create a `source` row (mode `live`, approval `approved`, allowedHosts, freshness, retention, budget), record the agreement here, then run a small import and the contract tests.

## Onboarding gate (Section 9.2)

1. Confirm permitted use; record it in this file (terms URL, review date, reviewer).
2. Provide credentials through the environment or a secret manager; never commit them.
3. Implement the adapter behind `CatalogProvider`. Keep source-specific fields inside it.
4. Run `pnpm source:probe <sourceId> --limit 3` (bounded, read-only).
5. Save sanitized fixtures only if retention is allowed, and keep them out of the public repo.
6. Verify currency, variant identifiers, condition, stock, URLs and freshness, then run the contract tests and failure simulations.
7. Enable only the capabilities that were verified (`source.capabilities`, `historyRetentionDays`).
