-- Per-variant search schedule for search-based live sources (SerpApi Google Shopping).
-- One search refreshes every seller's offer for that variant; budgets live in source_budget_day.
CREATE TABLE "live_sweep" (
  "variantId" TEXT PRIMARY KEY REFERENCES "product_variant"("id") ON DELETE CASCADE,
  "sourceId" TEXT NOT NULL REFERENCES "source"("id"),
  "nextDueAt" TIMESTAMP(3) NOT NULL,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastResult" JSONB
);

CREATE INDEX "live_sweep_sourceId_nextDueAt_idx" ON "live_sweep" ("sourceId", "nextDueAt");
