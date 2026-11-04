-- Database-enforced invariants (Section 17) that Prisma's schema language cannot express:
-- CHECK constraints, partial indexes, and catalog search indexes. Hand-written; review before
-- applying to a populated database (all statements are additive).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Money: non-negative, bounded, approved currencies ─────────────────────────────────────
ALTER TABLE "offer_quote"
  ADD CONSTRAINT offer_item_price_nonneg CHECK ("itemPriceMinor" IS NULL OR ("itemPriceMinor" >= 0 AND "itemPriceMinor" <= 1000000000000)),
  ADD CONSTRAINT offer_shipping_nonneg CHECK ("shippingMinor" IS NULL OR ("shippingMinor" >= 0 AND "shippingMinor" <= 1000000000000)),
  ADD CONSTRAINT offer_threshold_nonneg CHECK ("shippingThresholdMinor" IS NULL OR "shippingThresholdMinor" >= 0),
  ADD CONSTRAINT offer_fees_nonneg CHECK ("feesMinor" IS NULL OR ("feesMinor" >= 0 AND "feesMinor" <= 1000000000000)),
  ADD CONSTRAINT offer_currency_ok CHECK ("currency" IN ('CAD', 'USD')),
  ADD CONSTRAINT offer_condition_ok CHECK ("condition" IN ('new', 'refurbished', 'used', 'unknown')),
  ADD CONSTRAINT offer_stock_ok CHECK ("stock" IN ('in_stock', 'out_of_stock', 'unknown')),
  ADD CONSTRAINT offer_shipping_status_ok CHECK ("shippingStatus" IN ('known', 'unknown', 'threshold')),
  -- Known shipping must carry an amount; unknown shipping must not pretend to have one.
  ADD CONSTRAINT offer_shipping_consistent CHECK (
    ("shippingStatus" = 'known' AND "shippingMinor" IS NOT NULL)
    OR ("shippingStatus" = 'unknown' AND "shippingMinor" IS NULL)
    OR ("shippingStatus" = 'threshold' AND "shippingThresholdMinor" IS NOT NULL)
  ),
  ADD CONSTRAINT offer_fee_status_ok CHECK ("feeStatus" IN ('complete', 'unknown')),
  ADD CONSTRAINT offer_anomaly_ok CHECK ("anomalyStatus" IN ('none', 'pending_verification', 'confirmed', 'rejected')),
  ADD CONSTRAINT offer_generation_pos CHECK ("generation" > 0);

ALTER TABLE "price_observation"
  ADD CONSTRAINT obs_item_price_nonneg CHECK ("itemPriceMinor" IS NULL OR "itemPriceMinor" >= 0),
  ADD CONSTRAINT obs_shipping_nonneg CHECK ("shippingMinor" IS NULL OR "shippingMinor" >= 0),
  ADD CONSTRAINT obs_fees_nonneg CHECK ("feesMinor" IS NULL OR "feesMinor" >= 0),
  ADD CONSTRAINT obs_total_nonneg CHECK ("knownTotalMinor" IS NULL OR "knownTotalMinor" >= 0),
  ADD CONSTRAINT obs_currency_ok CHECK ("currency" IN ('CAD', 'USD'));

ALTER TABLE "watch"
  ADD CONSTRAINT watch_target_pos CHECK ("targetMinor" > 0 AND "targetMinor" <= 1000000000000),
  ADD CONSTRAINT watch_currency_ok CHECK ("currency" = 'CAD'),
  ADD CONSTRAINT watch_condition_ok CHECK ("condition" IN ('new', 'refurbished', 'used')),
  ADD CONSTRAINT watch_lifecycle_ok CHECK ("lifecycle" IN ('active', 'paused', 'deleted')),
  ADD CONSTRAINT watch_qual_ok CHECK ("qualification" IN ('armed', 'satisfied', 'unknown')),
  ADD CONSTRAINT watch_lastknown_ok CHECK ("lastKnownQualification" IN ('armed', 'satisfied')),
  ADD CONSTRAINT watch_episode_nonneg CHECK ("episode" >= 0 AND "rearmStreak" >= 0),
  ADD CONSTRAINT watch_version_pos CHECK ("version" >= 1 AND "ruleVersion" >= 1);

ALTER TABLE "purchase"
  ADD CONSTRAINT purchase_paid_nonneg CHECK ("paidTotalMinor" IS NULL OR ("paidTotalMinor" >= 0 AND "paidTotalMinor" <= 1000000000000)),
  ADD CONSTRAINT purchase_currency_ok CHECK ("currency" IS NULL OR "currency" IN ('CAD', 'USD')),
  ADD CONSTRAINT purchase_paid_has_currency CHECK ("paidTotalMinor" IS NULL OR "currency" IS NOT NULL),
  ADD CONSTRAINT purchase_status_ok CHECK ("status" IN ('active', 'cancelled'));

ALTER TABLE "purchase_item"
  ADD CONSTRAINT purchase_item_qty_pos CHECK ("quantity" > 0 AND "quantity" <= 10000),
  ADD CONSTRAINT purchase_item_price_nonneg CHECK ("unitPriceMinor" IS NULL OR "unitPriceMinor" >= 0),
  ADD CONSTRAINT purchase_item_status_ok CHECK ("status" IN ('kept', 'returned'));

ALTER TABLE "return_deadline"
  ADD CONSTRAINT deadline_date_format CHECK ("date" ~ '^\d{4}-\d{2}-\d{2}$'),
  ADD CONSTRAINT deadline_time_format CHECK ("cutoffTime" IS NULL OR "cutoffTime" ~ '^([01]\d|2[0-3]):[0-5]\d$'),
  ADD CONSTRAINT deadline_source_ok CHECK ("source" IN ('user_entered', 'user_confirmed_extraction', 'verified_policy')),
  ADD CONSTRAINT deadline_generation_pos CHECK ("generation" >= 1);

ALTER TABLE "reminder_schedule"
  ADD CONSTRAINT reminder_status_ok CHECK ("status" IN ('scheduled', 'claimed', 'sent', 'cancelled', 'skipped_past'));

ALTER TABLE "notification_delivery"
  ADD CONSTRAINT delivery_state_ok CHECK ("state" IN ('pending', 'claimed', 'accepted', 'retryable_failure', 'permanent_failure', 'unknown_outcome', 'suppressed', 'cancelled')),
  ADD CONSTRAINT delivery_channel_ok CHECK ("channel" IN ('email'));

ALTER TABLE "receipt"
  ADD CONSTRAINT receipt_state_ok CHECK ("state" IN ('pending', 'processing', 'ready', 'rejected', 'failed', 'deleting', 'deleted')),
  ADD CONSTRAINT receipt_declared_type_ok CHECK ("declaredType" IN ('application/pdf', 'image/jpeg', 'image/png')),
  ADD CONSTRAINT receipt_size_pos CHECK ("declaredSize" > 0);

ALTER TABLE "source"
  ADD CONSTRAINT source_mode_ok CHECK ("mode" IN ('demo', 'sandbox', 'live')),
  ADD CONSTRAINT source_budget_nonneg CHECK ("dailyRequestBudget" >= 0 AND "concurrency" >= 1);

ALTER TABLE "source_listing"
  ADD CONSTRAINT listing_match_status_ok CHECK ("matchStatus" IN ('unmatched', 'candidate', 'verified', 'rejected', 'quarantined')),
  -- Only verified listings carry a variant association.
  ADD CONSTRAINT listing_variant_only_when_verified CHECK ("variantId" IS NULL OR "matchStatus" = 'verified');

ALTER TABLE "quote_context"
  ADD CONSTRAINT context_qty_pos CHECK ("quantity" > 0),
  -- A destination-specific context must be owned by a user (never public).
  ADD CONSTRAINT context_private_destination CHECK ("destinationValue" IS NULL OR "ownerUserId" IS NOT NULL);

ALTER TABLE "user"
  ADD CONSTRAINT user_role_ok CHECK ("role" IN ('user', 'admin')),
  ADD CONSTRAINT user_deletion_ok CHECK ("deletionState" IN ('active', 'deleting', 'deleted'));

-- ── Due-work and owner-scoped indexes ─────────────────────────────────────────────────────
CREATE INDEX due_outbox_events ON "outbox_event" ("availableAt", "id") WHERE "completedAt" IS NULL;
CREATE INDEX due_deliveries ON "notification_delivery" ("notBefore") WHERE "state" IN ('pending', 'retryable_failure', 'claimed');
CREATE INDEX due_reminders ON "reminder_schedule" ("dueAt") WHERE "status" IN ('scheduled', 'claimed');
CREATE INDEX due_deletions ON "deletion_task" ("nextAttemptAt") WHERE "state" = 'pending';
CREATE INDEX user_watches_active ON "watch" ("userId", "createdAt" DESC) WHERE "lifecycle" <> 'deleted';
CREATE INDEX offer_expiry ON "offer_quote" ("expiresAt");

-- ── Catalog search (Section 14): full-text + trigram over the public catalog only ─────────
ALTER TABLE "product" ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce("brand", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("family", '')), 'A') ||
    setweight(to_tsvector('english', coalesce("title", '')), 'B') ||
    setweight(to_tsvector('english', coalesce("description", '')), 'D')
  ) STORED;
CREATE INDEX product_search_vector ON "product" USING GIN ("searchVector");
CREATE INDEX product_title_trgm ON "product" USING GIN ("title" gin_trgm_ops);
CREATE INDEX variant_model_trgm ON "product_variant" USING GIN ("modelCodeNormalized" gin_trgm_ops);
