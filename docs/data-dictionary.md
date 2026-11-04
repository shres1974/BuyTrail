# Data dictionary

Money is stored as `BIGINT` minor units plus a `currency`, and JSON carries it as decimal integer strings. Nullability expresses uncertainty: unknown shipping is `shippingStatus='unknown'` with `shippingMinor NULL`, never 0. Instants are UTC `timestamp(3)`. Purchase dates are `DATE` (local calendar date); deadlines store a `YYYY-MM-DD` string plus an IANA zone.

| Table | Ownership | Notes |
| --- | --- | --- |
| user, session, account, verification | Private / Better Auth | `role` (user/admin), `timezone`, email preferences, `deletionState`, `settingsVersion` for optimistic edits. |
| source | Admin | mode (demo/sandbox/live), approvalStatus, capabilities JSON, allowedHosts, freshness, historyRetentionDays (null = history forbidden), daily budget, circuit/rate-limit state. |
| source_budget_day | Operational | Atomic conditional increment per source and UTC day. |
| merchant, product, product_variant, product_identifier | Public catalog | Variants carry the exact critical attributes. GTINs are normalized to a zero-padded GTIN-14 string; the original is kept. `product.searchVector` is a generated tsvector. |
| source_listing | Source-controlled | Unique on (source, market, externalListingId, externalVariantKey, sellerKey). `variantId` only when `matchStatus='verified'` (CHECK). `refreshGeneration` is the last claimed generation. |
| match_decision | Internal audit | Every match status change, with evidence, rule version, decidedBy (`rule:match-v1` / `admin:<id>`) and the previous variant. |
| quote_context | Public or owned | A `destinationValue` requires an owner (CHECK). |
| offer_quote | Derived current state | One per (listing, context); generation; anomaly status; expiresAt (strictest bound); expiryNotedAt for the sweep; invalidatedAt after a match correction. |
| price_observation | Immutable within retention | Unique (source, runId, recordKey). Stores variantIdAtObservation, normalization version, supersededByNewer, retainUntil. |
| refresh_run, refresh_schedule | Operational | Claim leases; one schedule per (listing, context) shared by all watches. |
| variant_eval_generation | Operational | Max input generation per (variant, context). |
| watch | Private | Exact variant, condition, context, target. Lifecycle (active/paused/deleted); qualification (armed/satisfied/unknown) plus lastKnownQualification; episode, rearmStreak, ruleVersion, version. |
| watch_evaluation | Private, bounded | Every decision with its input generation. |
| notification_event | Private durable inbox | Unique `logicalKey`. |
| notification_delivery | Private | Unique (event, channel) and idempotencyKey. States: pending, claimed, accepted, retryable_failure, permanent_failure, unknown_outcome, suppressed, cancelled. `sendStartedAt` marks a possible external side effect. |
| purchase, purchase_item | Private | Immutable description snapshot, paid total as entered (tax included if the user entered it), optional variant link. |
| return_deadline, reminder_schedule | Private | Generation-based. Unique (deadline, generation, offsetDays). |
| receipt | Private | quarantine `objectKey`, `readyKey`, `previewKey` (never sent to clients); states pending → processing → ready / rejected / failed; deleted. |
| account_export | Private | Expires 24 h after it is ready. |
| deletion_task, deletion_tombstone | Operational | Retryable object/account deletion; hashed tombstones for reconciling restores. |
| outbox_event | Operational | dispatchedAt / processingStartedAt / leaseExpiresAt / completedAt / attempts. |
| idempotency_record | Private, 24 h | Unique (user, operation, key) plus request hash. |
| audit_event, worker_heartbeat, product_request, demo_price_override | Operational | demo_price_override is read only by the demo provider. |

## Retention (current defaults)
- Demo observations: 180 days (`source.historyRetentionDays`). Sources without history permission store no observations.
- Idempotency records: 24 h (purged by the worker).
- Exports: 24 h, then the object is deleted.
- Rejected or deleted receipt objects: deleted by the deletion worker.
- Watch evaluations and outbox rows: no purge job yet (known gap; see implementation-status.md).
