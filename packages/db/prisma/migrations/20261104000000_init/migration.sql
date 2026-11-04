-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "user" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "role" TEXT NOT NULL DEFAULT 'user',
    "emailAlerts" BOOLEAN NOT NULL DEFAULT true,
    "emailReminders" BOOLEAN NOT NULL DEFAULT true,
    "categoryEmailOptOut" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deletionState" TEXT NOT NULL DEFAULT 'active',
    "deletionRequestedAt" TIMESTAMP(3),
    "settingsVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'enabled',
    "approvalStatus" TEXT NOT NULL,
    "permissionsRevision" INTEGER NOT NULL DEFAULT 1,
    "capabilities" JSONB NOT NULL,
    "allowedHosts" TEXT[],
    "freshnessSeconds" INTEGER NOT NULL,
    "historyRetentionDays" INTEGER,
    "dailyRequestBudget" INTEGER NOT NULL,
    "concurrency" INTEGER NOT NULL DEFAULT 2,
    "nextEligibleRequestAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_budget_day" (
    "sourceId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "source_budget_day_pkey" PRIMARY KEY ("sourceId","day")
);

-- CreateTable
CREATE TABLE "merchant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT,
    "displayUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "merchant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "modelCode" TEXT NOT NULL,
    "modelCodeNormalized" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "market" TEXT NOT NULL DEFAULT 'CA',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "searchSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_identifier" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "original" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,

    CONSTRAINT "product_identifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_listing" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "externalListingId" TEXT NOT NULL,
    "externalVariantKey" TEXT NOT NULL,
    "sellerKey" TEXT NOT NULL,
    "merchantId" TEXT,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "identifiers" JSONB NOT NULL,
    "attributes" JSONB NOT NULL,
    "outboundUrl" TEXT NOT NULL,
    "imageUrl" TEXT,
    "variantId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchVersion" INTEGER NOT NULL DEFAULT 0,
    "refreshGeneration" BIGINT NOT NULL DEFAULT 0,
    "lastInterestAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_decision" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "candidateVariantIds" TEXT[],
    "chosenVariantId" TEXT,
    "previousVariantId" TEXT,
    "evidence" JSONB NOT NULL,
    "reason" TEXT,
    "ruleVersion" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "reviewState" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_context" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "destinationScope" TEXT NOT NULL,
    "destinationValue" TEXT,
    "ownerUserId" TEXT,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quote_context_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offer_quote" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "stock" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "itemPriceMinor" BIGINT,
    "shippingStatus" TEXT NOT NULL,
    "shippingMinor" BIGINT,
    "shippingThresholdMinor" BIGINT,
    "shippingUnknownReason" TEXT,
    "feesMinor" BIGINT,
    "feeStatus" TEXT NOT NULL,
    "restrictions" JSONB NOT NULL DEFAULT '[]',
    "anomalyStatus" TEXT NOT NULL DEFAULT 'none',
    "anomalyReason" TEXT,
    "sourceObservedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "lastSuccessfulCheckAt" TIMESTAMP(3) NOT NULL,
    "lastCheckFailedAt" TIMESTAMP(3),
    "lastCheckFailure" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "generation" BIGINT NOT NULL,
    "observationId" TEXT,
    "invalidatedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offer_quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_observation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceMode" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "recordKey" TEXT NOT NULL,
    "generation" BIGINT NOT NULL,
    "condition" TEXT NOT NULL,
    "stock" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "itemPriceMinor" BIGINT,
    "shippingStatus" TEXT NOT NULL,
    "shippingMinor" BIGINT,
    "shippingThresholdMinor" BIGINT,
    "feesMinor" BIGINT,
    "feeStatus" TEXT NOT NULL,
    "knownTotalMinor" BIGINT,
    "sourceObservedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "normalizationVersion" TEXT NOT NULL,
    "matchVersion" INTEGER NOT NULL,
    "variantIdAtObservation" TEXT,
    "qualityFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supersededByNewer" BOOLEAN NOT NULL DEFAULT false,
    "retainUntil" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_observation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_run" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "listingId" TEXT,
    "contextId" TEXT,
    "kind" TEXT NOT NULL,
    "generation" BIGINT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'claimed',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorDetail" TEXT,

    CONSTRAINT "refresh_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_schedule" (
    "listingId" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "intervalSeconds" INTEGER NOT NULL,

    CONSTRAINT "refresh_schedule_pkey" PRIMARY KEY ("listingId","contextId")
);

-- CreateTable
CREATE TABLE "watch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "contextId" TEXT NOT NULL,
    "targetMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "channels" TEXT[],
    "notifyIfAlreadyQualifying" BOOLEAN NOT NULL DEFAULT false,
    "ruleVersion" INTEGER NOT NULL DEFAULT 1,
    "lifecycle" TEXT NOT NULL DEFAULT 'active',
    "qualification" TEXT NOT NULL DEFAULT 'unknown',
    "lastKnownQualification" TEXT NOT NULL DEFAULT 'armed',
    "episode" INTEGER NOT NULL DEFAULT 0,
    "rearmStreak" INTEGER NOT NULL DEFAULT 0,
    "lastEvaluatedGeneration" BIGINT NOT NULL DEFAULT 0,
    "lastBestTotalMinor" BIGINT,
    "lastBestOfferId" TEXT,
    "lastEvaluatedAt" TIMESTAMP(3),
    "lastEmailAttemptAt" TIMESTAMP(3),
    "lastEmailAcceptedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watch_evaluation" (
    "id" TEXT NOT NULL,
    "watchId" TEXT NOT NULL,
    "ruleVersion" INTEGER NOT NULL,
    "generation" BIGINT NOT NULL,
    "decision" TEXT NOT NULL,
    "bestTotalMinor" BIGINT,
    "bestOfferId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watch_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_event" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "logicalKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "watchId" TEXT,
    "ruleVersion" INTEGER,
    "readAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_delivery" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "notBefore" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "lastError" TEXT,
    "suppressedReason" TEXT,
    "claimedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "merchantName" TEXT NOT NULL,
    "merchantId" TEXT,
    "purchasedOn" DATE NOT NULL,
    "paidTotalMinor" BIGINT,
    "currency" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_item" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "variantId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT,
    "status" TEXT NOT NULL DEFAULT 'kept',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_deadline" (
    "id" TEXT NOT NULL,
    "purchaseItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "cutoffTime" TEXT,
    "timezone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "removedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "return_deadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_schedule" (
    "id" TEXT NOT NULL,
    "deadlineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generation" INTEGER NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "localLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "readyKey" TEXT,
    "previewKey" TEXT,
    "declaredType" TEXT NOT NULL,
    "declaredSize" INTEGER NOT NULL,
    "detectedType" TEXT,
    "actualSize" INTEGER,
    "checksum" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "rejectReason" TEXT,
    "isSynthetic" BOOLEAN NOT NULL DEFAULT false,
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_export" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "objectKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_task" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deletion_tombstone" (
    "subjectHash" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deletion_tombstone_pkey" PRIMARY KEY ("subjectHash")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "leaseExpiresAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_record" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseRef" TEXT,
    "responseStatus" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_heartbeat" (
    "workerId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "lastBeatAt" TIMESTAMP(3) NOT NULL,
    "info" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "worker_heartbeat_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
CREATE TABLE "product_request" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_key" ON "session"("token");

-- CreateIndex
CREATE INDEX "session_userId_idx" ON "session"("userId");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "verification_identifier_idx" ON "verification"("identifier");

-- CreateIndex
CREATE INDEX "product_category_idx" ON "product"("category");

-- CreateIndex
CREATE INDEX "product_variant_productId_idx" ON "product_variant"("productId");

-- CreateIndex
CREATE INDEX "product_variant_modelCodeNormalized_idx" ON "product_variant"("modelCodeNormalized");

-- CreateIndex
CREATE INDEX "product_identifier_kind_normalized_idx" ON "product_identifier"("kind", "normalized");

-- CreateIndex
CREATE UNIQUE INDEX "product_identifier_kind_normalized_variantId_key" ON "product_identifier"("kind", "normalized", "variantId");

-- CreateIndex
CREATE INDEX "source_listing_variantId_idx" ON "source_listing"("variantId");

-- CreateIndex
CREATE INDEX "source_listing_matchStatus_idx" ON "source_listing"("matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "source_listing_sourceId_market_externalListingId_externalVa_key" ON "source_listing"("sourceId", "market", "externalListingId", "externalVariantKey", "sellerKey");

-- CreateIndex
CREATE INDEX "match_decision_listingId_createdAt_idx" ON "match_decision"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "match_decision_reviewState_status_idx" ON "match_decision"("reviewState", "status");

-- CreateIndex
CREATE INDEX "quote_context_ownerUserId_idx" ON "quote_context"("ownerUserId");

-- CreateIndex
CREATE INDEX "offer_quote_contextId_expiresAt_idx" ON "offer_quote"("contextId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "offer_quote_listingId_contextId_key" ON "offer_quote"("listingId", "contextId");

-- CreateIndex
CREATE INDEX "price_observation_listingId_contextId_fetchedAt_idx" ON "price_observation"("listingId", "contextId", "fetchedAt");

-- CreateIndex
CREATE INDEX "price_observation_retainUntil_idx" ON "price_observation"("retainUntil");

-- CreateIndex
CREATE UNIQUE INDEX "price_observation_sourceId_runId_recordKey_key" ON "price_observation"("sourceId", "runId", "recordKey");

-- CreateIndex
CREATE INDEX "refresh_run_sourceId_status_idx" ON "refresh_run"("sourceId", "status");

-- CreateIndex
CREATE INDEX "refresh_run_listingId_contextId_generation_idx" ON "refresh_run"("listingId", "contextId", "generation");

-- CreateIndex
CREATE INDEX "refresh_schedule_dueAt_idx" ON "refresh_schedule"("dueAt");

-- CreateIndex
CREATE INDEX "watch_userId_lifecycle_idx" ON "watch"("userId", "lifecycle");

-- CreateIndex
CREATE INDEX "watch_variantId_contextId_lifecycle_idx" ON "watch"("variantId", "contextId", "lifecycle");

-- CreateIndex
CREATE INDEX "watch_evaluation_watchId_createdAt_idx" ON "watch_evaluation"("watchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_logicalKey_key" ON "notification_event"("logicalKey");

-- CreateIndex
CREATE INDEX "notification_event_userId_createdAt_idx" ON "notification_event"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_idempotencyKey_key" ON "notification_delivery"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_delivery_state_notBefore_idx" ON "notification_delivery"("state", "notBefore");

-- CreateIndex
CREATE UNIQUE INDEX "notification_delivery_eventId_channel_key" ON "notification_delivery"("eventId", "channel");

-- CreateIndex
CREATE INDEX "purchase_userId_purchasedOn_id_idx" ON "purchase"("userId", "purchasedOn" DESC, "id");

-- CreateIndex
CREATE INDEX "purchase_item_purchaseId_idx" ON "purchase_item"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "return_deadline_purchaseItemId_key" ON "return_deadline"("purchaseItemId");

-- CreateIndex
CREATE INDEX "return_deadline_userId_idx" ON "return_deadline"("userId");

-- CreateIndex
CREATE INDEX "reminder_schedule_status_dueAt_idx" ON "reminder_schedule"("status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_schedule_deadlineId_generation_offsetDays_key" ON "reminder_schedule"("deadlineId", "generation", "offsetDays");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_objectKey_key" ON "receipt"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "receipt_readyKey_key" ON "receipt"("readyKey");

-- CreateIndex
CREATE INDEX "receipt_userId_purchaseId_idx" ON "receipt"("userId", "purchaseId");

-- CreateIndex
CREATE INDEX "account_export_userId_idx" ON "account_export"("userId");

-- CreateIndex
CREATE INDEX "deletion_task_state_nextAttemptAt_idx" ON "deletion_task"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "deletion_task_kind_target_key" ON "deletion_task"("kind", "target");

-- CreateIndex
CREATE INDEX "outbox_event_completedAt_availableAt_idx" ON "outbox_event"("completedAt", "availableAt");

-- CreateIndex
CREATE INDEX "idempotency_record_expiresAt_idx" ON "idempotency_record"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_record_userId_operation_key_key" ON "idempotency_record"("userId", "operation", "key");

-- CreateIndex
CREATE INDEX "audit_event_createdAt_idx" ON "audit_event"("createdAt");

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_budget_day" ADD CONSTRAINT "source_budget_day_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_productId_fkey" FOREIGN KEY ("productId") REFERENCES "product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_identifier" ADD CONSTRAINT "product_identifier_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_listing" ADD CONSTRAINT "source_listing_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_listing" ADD CONSTRAINT "source_listing_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_listing" ADD CONSTRAINT "source_listing_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_decision" ADD CONSTRAINT "match_decision_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "source_listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_context" ADD CONSTRAINT "quote_context_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_quote" ADD CONSTRAINT "offer_quote_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "source_listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offer_quote" ADD CONSTRAINT "offer_quote_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "quote_context"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_observation" ADD CONSTRAINT "price_observation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "source_listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_run" ADD CONSTRAINT "refresh_run_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_run" ADD CONSTRAINT "refresh_run_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "source_listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch" ADD CONSTRAINT "watch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch" ADD CONSTRAINT "watch_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch" ADD CONSTRAINT "watch_contextId_fkey" FOREIGN KEY ("contextId") REFERENCES "quote_context"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watch_evaluation" ADD CONSTRAINT "watch_evaluation_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "watch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_event" ADD CONSTRAINT "notification_event_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_delivery" ADD CONSTRAINT "notification_delivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "notification_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase" ADD CONSTRAINT "purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_item" ADD CONSTRAINT "purchase_item_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_deadline" ADD CONSTRAINT "return_deadline_purchaseItemId_fkey" FOREIGN KEY ("purchaseItemId") REFERENCES "purchase_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedule" ADD CONSTRAINT "reminder_schedule_deadlineId_fkey" FOREIGN KEY ("deadlineId") REFERENCES "return_deadline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_export" ADD CONSTRAINT "account_export_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_record" ADD CONSTRAINT "idempotency_record_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
