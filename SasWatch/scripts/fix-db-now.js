#!/usr/bin/env node
// One-off fixer: ensure platformAdmin column and account_members table exist in the target DB.
// Run with DATABASE_URL pointing to the desired database (e.g., Railway proxy).

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('[FixDB] Starting direct schema fix...');
  console.log('[FixDB] DATABASE_URL:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 60) + '...' : 'MISSING');

  try {
    const statements = [
      `ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "platformAdmin" BOOLEAN NOT NULL DEFAULT false;`,
      `DO $$ BEGIN
        BEGIN
          ALTER TABLE "accounts" ALTER COLUMN "password" DROP NOT NULL;
        EXCEPTION WHEN others THEN NULL;
        END;
      END $$;`,
      `CREATE TABLE IF NOT EXISTS "account_members" (
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
      );`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "account_members_email_key" ON "account_members"("email");`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "account_members_emailVerificationToken_key" ON "account_members"("emailVerificationToken");`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "account_members_passwordResetToken_key" ON "account_members"("passwordResetToken");`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "account_members_invitationToken_key" ON "account_members"("invitationToken");`,
      `CREATE INDEX IF NOT EXISTS "account_members_accountId_idx" ON "account_members"("accountId");`,
      `CREATE INDEX IF NOT EXISTS "account_members_email_idx" ON "account_members"("email");`,
      `CREATE INDEX IF NOT EXISTS "account_members_role_idx" ON "account_members"("role");`,
      `DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'account_members_accountId_fkey'
        ) THEN
          ALTER TABLE "account_members"
          ADD CONSTRAINT "account_members_accountId_fkey"
          FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
        END IF;
      END $$;`
    ];

    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt);
    }

    console.log('[FixDB] ✓ Schema ensured successfully');
  } catch (err) {
    console.error('[FixDB] ✗ Failed to ensure schema:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();


