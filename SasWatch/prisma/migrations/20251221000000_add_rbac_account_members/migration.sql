-- AlterTable: Add platformAdmin column to accounts
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "platformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Make password nullable (for backward compatibility with RBAC)
ALTER TABLE "accounts" ALTER COLUMN "password" DROP NOT NULL;

-- CreateTable: account_members
CREATE TABLE IF NOT EXISTS "account_members" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerificationToken" TEXT,
    "emailVerificationExpires" TIMESTAMP(3),
    "passwordResetToken" TEXT,
    "passwordResetExpires" TIMESTAMP(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mfaSecret" TEXT,
    "mfaBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "mfaMethod" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "invitedBy" TEXT,
    "invitationToken" TEXT,
    "invitationExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_members_email_key" ON "account_members"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_members_emailVerificationToken_key" ON "account_members"("emailVerificationToken");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_members_passwordResetToken_key" ON "account_members"("passwordResetToken");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "account_members_invitationToken_key" ON "account_members"("invitationToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_members_accountId_idx" ON "account_members"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_members_email_idx" ON "account_members"("email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "account_members_role_idx" ON "account_members"("role");

-- AddForeignKey
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

