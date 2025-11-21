-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionTier" TEXT NOT NULL DEFAULT 'free',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastLoginAt" TIMESTAMP(3),
    "entraLastSyncAt" TIMESTAMP(3),
    "entraTenantId" TEXT,
    "entraConnectedAt" TIMESTAMP(3),
    "entraSignInCursor" TEXT,
    "entraSignInLastSyncAt" TIMESTAMP(3),
    "hiddenLicenses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "emailVerificationExpires" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "mfaSecret" TEXT,
    "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mfaMethod" TEXT,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "adminRoles" TEXT,
    "userGroups" TEXT,
    "licenses" TEXT[],
    "lastActivity" TIMESTAMP(3),
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "entraId" TEXT,
    "entraAccountEnabled" BOOLEAN,
    "entraLicenses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "entraLastSyncedAt" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "windows_usernames" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "windows_usernames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unmapped_usernames" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "activityCount" INTEGER NOT NULL DEFAULT 0,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unmapped_usernames_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "tabId" INTEGER,
    "clientId" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "when" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "windowsUser" TEXT,
    "userDomain" TEXT,
    "computerName" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "detectedUsers" INTEGER NOT NULL DEFAULT 0,
    "licensesOwned" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_overrides" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "vendor" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "licensesOwned" INTEGER NOT NULL DEFAULT 0,
    "isHidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entra_signins" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdDateTime" TIMESTAMP(3) NOT NULL,
    "userDisplayName" TEXT,
    "userPrincipalName" TEXT,
    "userId" TEXT,
    "appDisplayName" TEXT,
    "resourceDisplayName" TEXT,
    "clientAppUsed" TEXT,
    "deviceDisplayName" TEXT,
    "operatingSystem" TEXT,
    "browser" TEXT,
    "ipAddress" TEXT,
    "locationCity" TEXT,
    "locationCountryOrRegion" TEXT,
    "statusErrorCode" INTEGER,
    "statusFailureReason" TEXT,
    "riskState" TEXT,
    "riskDetail" TEXT,
    "conditionalAccessStatus" TEXT,
    "correlationId" TEXT,
    "isInteractive" BOOLEAN,
    "sourceChannel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entra_signins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_apiKey_key" ON "accounts"("apiKey");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_emailVerificationToken_key" ON "accounts"("emailVerificationToken");

-- CreateIndex
CREATE INDEX "accounts_email_idx" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "accounts_apiKey_idx" ON "accounts"("apiKey");

-- CreateIndex
CREATE INDEX "users_accountId_idx" ON "users"("accountId");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_lastActivity_idx" ON "users"("lastActivity");

-- CreateIndex
CREATE UNIQUE INDEX "users_accountId_email_key" ON "users"("accountId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "windows_usernames_username_key" ON "windows_usernames"("username");

-- CreateIndex
CREATE INDEX "windows_usernames_username_idx" ON "windows_usernames"("username");

-- CreateIndex
CREATE INDEX "windows_usernames_userId_idx" ON "windows_usernames"("userId");

-- CreateIndex
CREATE INDEX "unmapped_usernames_accountId_idx" ON "unmapped_usernames"("accountId");

-- CreateIndex
CREATE INDEX "unmapped_usernames_username_idx" ON "unmapped_usernames"("username");

-- CreateIndex
CREATE UNIQUE INDEX "unmapped_usernames_accountId_username_key" ON "unmapped_usernames"("accountId", "username");

-- CreateIndex
CREATE INDEX "usage_events_accountId_idx" ON "usage_events"("accountId");

-- CreateIndex
CREATE INDEX "usage_events_clientId_idx" ON "usage_events"("clientId");

-- CreateIndex
CREATE INDEX "usage_events_windowsUser_idx" ON "usage_events"("windowsUser");

-- CreateIndex
CREATE INDEX "usage_events_when_idx" ON "usage_events"("when");

-- CreateIndex
CREATE INDEX "usage_events_receivedAt_idx" ON "usage_events"("receivedAt");

-- CreateIndex
CREATE INDEX "usage_events_source_idx" ON "usage_events"("source");

-- CreateIndex
CREATE INDEX "usage_events_event_idx" ON "usage_events"("event");

-- CreateIndex
CREATE INDEX "applications_accountId_idx" ON "applications"("accountId");

-- CreateIndex
CREATE INDEX "applications_vendor_idx" ON "applications"("vendor");

-- CreateIndex
CREATE UNIQUE INDEX "applications_accountId_vendor_name_key" ON "applications"("accountId", "vendor", "name");

-- CreateIndex
CREATE INDEX "app_overrides_accountId_idx" ON "app_overrides"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "app_overrides_accountId_sourceKey_key" ON "app_overrides"("accountId", "sourceKey");

-- CreateIndex
CREATE INDEX "entra_signins_accountId_createdDateTime_idx" ON "entra_signins"("accountId", "createdDateTime");

-- CreateIndex
CREATE INDEX "entra_signins_accountId_userPrincipalName_idx" ON "entra_signins"("accountId", "userPrincipalName");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "windows_usernames" ADD CONSTRAINT "windows_usernames_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unmapped_usernames" ADD CONSTRAINT "unmapped_usernames_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_overrides" ADD CONSTRAINT "app_overrides_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entra_signins" ADD CONSTRAINT "entra_signins_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
