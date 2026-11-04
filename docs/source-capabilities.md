# Source capabilities

Unknown permission means the capability stays disabled (Section 9.1). Live comparison remains **gated**: no live or sandbox source is approved or connected in this build. Operating level: **D0 (demonstration)**.

## Active sources

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
