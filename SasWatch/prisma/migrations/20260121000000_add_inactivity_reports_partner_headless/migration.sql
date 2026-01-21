-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "inactivityAlertEmail" TEXT,
ADD COLUMN     "inactivityAlertEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inactivityAlertLastSent" TIMESTAMP(3),
ADD COLUMN     "inactivityAlertThreshold" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "licenseCosts" JSONB DEFAULT '{}',
ADD COLUMN     "notificationPreferences" JSONB DEFAULT '{}',
ADD COLUMN     "passwordResetExpires" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" TEXT,
ALTER COLUMN "mfaEnabled" SET DEFAULT true;

-- AlterTable
ALTER TABLE "usage_events" ADD COLUMN     "browser" TEXT,
ADD COLUMN     "windowTitle" TEXT;

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "dayOfWeek" TEXT,
    "dayOfMonth" INTEGER,
    "recipients" TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "renewalDate" TIMESTAMP(3) NOT NULL,
    "cancelByDate" TIMESTAMP(3),
    "cost" DECIMAL(12,2),
    "billingCycle" TEXT NOT NULL DEFAULT 'annual',
    "accountNumber" TEXT,
    "seats" INTEGER,
    "owner" TEXT,
    "notes" TEXT,
    "alertEmail" TEXT,
    "alertDays" INTEGER[] DEFAULT ARRAY[60, 30, 7]::INTEGER[],
    "lastAlertSent" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_subscriptions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceEmailId" TEXT,
    "senderEmail" TEXT,
    "vendor" TEXT,
    "name" TEXT,
    "cost" DECIMAL(12,2),
    "renewalDate" TIMESTAMP(3),
    "billingCycle" TEXT,
    "accountNumber" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rawText" TEXT,
    "attachmentNames" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "partnerApiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyName" TEXT,
    "maxLinkedAccounts" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_account_links" (
    "id" TEXT NOT NULL,
    "partnerAccountId" TEXT NOT NULL,
    "linkedAccountId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nickname" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "permissions" TEXT[] DEFAULT ARRAY['read']::TEXT[],

    CONSTRAINT "partner_account_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "headless_connectors" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sessionData" TEXT,
    "encryptedCreds" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "headless_connectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_accountId_idx" ON "audit_logs"("accountId");

-- CreateIndex
CREATE INDEX "audit_logs_accountId_action_idx" ON "audit_logs"("accountId", "action");

-- CreateIndex
CREATE INDEX "audit_logs_accountId_createdAt_idx" ON "audit_logs"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "scheduled_reports_accountId_idx" ON "scheduled_reports"("accountId");

-- CreateIndex
CREATE INDEX "scheduled_reports_accountId_enabled_idx" ON "scheduled_reports"("accountId", "enabled");

-- CreateIndex
CREATE INDEX "subscriptions_accountId_idx" ON "subscriptions"("accountId");

-- CreateIndex
CREATE INDEX "subscriptions_accountId_renewalDate_idx" ON "subscriptions"("accountId", "renewalDate");

-- CreateIndex
CREATE INDEX "subscriptions_renewalDate_idx" ON "subscriptions"("renewalDate");

-- CreateIndex
CREATE INDEX "pending_subscriptions_accountId_idx" ON "pending_subscriptions"("accountId");

-- CreateIndex
CREATE INDEX "pending_subscriptions_status_idx" ON "pending_subscriptions"("status");

-- CreateIndex
CREATE INDEX "pending_subscriptions_accountId_status_idx" ON "pending_subscriptions"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "pending_subscriptions_accountId_sourceEmailId_key" ON "pending_subscriptions"("accountId", "sourceEmailId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_accounts_accountId_key" ON "partner_accounts"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_accounts_partnerApiKey_key" ON "partner_accounts"("partnerApiKey");

-- CreateIndex
CREATE INDEX "partner_accounts_partnerApiKey_idx" ON "partner_accounts"("partnerApiKey");

-- CreateIndex
CREATE INDEX "partner_account_links_partnerAccountId_idx" ON "partner_account_links"("partnerAccountId");

-- CreateIndex
CREATE INDEX "partner_account_links_linkedAccountId_idx" ON "partner_account_links"("linkedAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_account_links_partnerAccountId_linkedAccountId_key" ON "partner_account_links"("partnerAccountId", "linkedAccountId");

-- CreateIndex
CREATE INDEX "headless_connectors_accountId_idx" ON "headless_connectors"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "headless_connectors_accountId_vendor_key" ON "headless_connectors"("accountId", "vendor");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_passwordResetToken_key" ON "accounts"("passwordResetToken");

-- CreateIndex
CREATE INDEX "usage_events_accountId_source_receivedAt_idx" ON "usage_events"("accountId", "source", "receivedAt");

-- CreateIndex
CREATE INDEX "usage_events_accountId_receivedAt_idx" ON "usage_events"("accountId", "receivedAt");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_subscriptions" ADD CONSTRAINT "pending_subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_accounts" ADD CONSTRAINT "partner_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_account_links" ADD CONSTRAINT "partner_account_links_partnerAccountId_fkey" FOREIGN KEY ("partnerAccountId") REFERENCES "partner_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_account_links" ADD CONSTRAINT "partner_account_links_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "headless_connectors" ADD CONSTRAINT "headless_connectors_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

