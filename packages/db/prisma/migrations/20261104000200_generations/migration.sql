-- Ordering and reliability support (Sections 11, 19, 21).

-- Monotonic per-(variant, context) evaluation generation. Bumped (from a global sequence)
-- whenever anything that can change a watch's comparison input changes: an accepted quote,
-- a match correction, an expiry sweep or an anomaly resolution. Watches only evaluate an
-- input generation newer than the last one they evaluated (G12, G13).
CREATE SEQUENCE eval_generation_seq AS bigint START 1;

CREATE TABLE "variant_eval_generation" (
  "variantId" TEXT NOT NULL REFERENCES "product_variant"("id"),
  "contextId" TEXT NOT NULL REFERENCES "quote_context"("id") ON DELETE CASCADE,
  "generation" BIGINT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("variantId", "contextId")
);

-- Set when the expiry sweep has accounted for a quote's expiry; cleared by a new observation.
ALTER TABLE "offer_quote" ADD COLUMN "expiryNotedAt" TIMESTAMP(3);
CREATE INDEX offer_expiry_unnoted ON "offer_quote" ("expiresAt") WHERE "expiryNotedAt" IS NULL;

-- Set (and committed) immediately before an external email call. A claimed delivery whose
-- lease expired with sendStartedAt set has an unknown outcome and is never blindly resent (G18).
ALTER TABLE "notification_delivery" ADD COLUMN "sendStartedAt" TIMESTAMP(3);

-- Demonstration-only scripted price overrides read by the demo provider. Shared across web and
-- worker processes. Never used by non-demo sources.
CREATE TABLE "demo_price_override" (
  "externalListingId" TEXT PRIMARY KEY,
  "itemPriceMinor" BIGINT NOT NULL CHECK ("itemPriceMinor" >= 0),
  "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
