#!/usr/bin/env node
/**
 * Ensure platformAdmin column exists
 * This is a safety check in case migrations haven't run yet
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function ensurePlatformAdminColumn() {
    try {
        // Try to query with platformAdmin - if it fails, the column doesn't exist
        await prisma.$queryRaw`SELECT "platformAdmin" FROM "accounts" LIMIT 1`;
        console.log('[Migration Check] ✓ platformAdmin column exists');
        return true;
    } catch (error) {
        if (error.code === 'P2022' || error.message?.includes('does not exist')) {
            console.log('[Migration Check] ⚠️  platformAdmin column missing, adding it...');
            try {
                // Add the column directly
                await prisma.$executeRawUnsafe(`
                    ALTER TABLE "accounts" 
                    ADD COLUMN IF NOT EXISTS "platformAdmin" BOOLEAN NOT NULL DEFAULT false;
                `);
                console.log('[Migration Check] ✓ Added platformAdmin column');
                
                // Verify it was added
                await prisma.$queryRaw`SELECT "platformAdmin" FROM "accounts" LIMIT 1`;
                console.log('[Migration Check] ✓ Verified platformAdmin column exists');
                return true;
            } catch (addError) {
                console.error('[Migration Check] ✗ Failed to add platformAdmin column:', addError.message);
                console.error('[Migration Check] Error details:', addError);
                return false;
            }
        }
        // Some other error
        console.error('[Migration Check] Unexpected error:', error.message);
        console.error('[Migration Check] Error code:', error.code);
        return false;
    }
}

async function ensureAccountMembersTable() {
    try {
        // Try to query account_members table
        await prisma.$queryRaw`SELECT 1 FROM "account_members" LIMIT 1`;
        console.log('[Migration Check] account_members table exists ✓');
        return true;
    } catch (error) {
        if (error.code === 'P2022' || error.message?.includes('does not exist')) {
            console.log('[Migration Check] ⚠️  account_members table missing, creating it...');
            try {
                await prisma.$executeRawUnsafe(`
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

                    CREATE UNIQUE INDEX IF NOT EXISTS "account_members_email_key" ON "account_members"("email");
                    CREATE UNIQUE INDEX IF NOT EXISTS "account_members_emailVerificationToken_key" ON "account_members"("emailVerificationToken");
                    CREATE UNIQUE INDEX IF NOT EXISTS "account_members_passwordResetToken_key" ON "account_members"("passwordResetToken");
                    CREATE UNIQUE INDEX IF NOT EXISTS "account_members_invitationToken_key" ON "account_members"("invitationToken");
                    CREATE INDEX IF NOT EXISTS "account_members_accountId_idx" ON "account_members"("accountId");
                    CREATE INDEX IF NOT EXISTS "account_members_email_idx" ON "account_members"("email");
                    CREATE INDEX IF NOT EXISTS "account_members_role_idx" ON "account_members"("role");

                    DO $$ BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM pg_constraint WHERE conname = 'account_members_accountId_fkey'
                        ) THEN
                            ALTER TABLE "account_members"
                            ADD CONSTRAINT "account_members_accountId_fkey" FOREIGN KEY ("accountId")
                            REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
                        END IF;
                    END $$;
                `);

                console.log('[Migration Check] ✓ Created account_members table');
                return true;
            } catch (createError) {
                console.error('[Migration Check] ✗ Failed to create account_members table:', createError.message);
                console.error('[Migration Check] Error details:', createError);
                return false;
            }
        }
        return true; // Table exists or different error
    }
}

async function main() {
    console.log('[Migration Check] ============================================');
    console.log('[Migration Check] Checking database schema...');
    console.log('[Migration Check] DATABASE_URL:', process.env.DATABASE_URL ? 'Set (' + process.env.DATABASE_URL.substring(0, 30) + '...)' : 'Missing');
    console.log('[Migration Check] ============================================');
    
    try {
        const platformAdminOk = await ensurePlatformAdminColumn();
        const accountMembersOk = await ensureAccountMembersTable();
        
        console.log('[Migration Check] ============================================');
        if (platformAdminOk && accountMembersOk) {
            console.log('[Migration Check] ✓ Database schema is ready');
        } else {
            console.log('[Migration Check] ⚠️  Some columns/tables may be missing. Migration will attempt to fix this.');
        }
        console.log('[Migration Check] ============================================');
        process.exit(0);
    } catch (error) {
        console.error('[Migration Check] ✗ Fatal error:', error.message);
        console.error('[Migration Check] Stack:', error.stack);
        console.log('[Migration Check] ⚠️  Continuing anyway - migration will attempt to fix issues');
        console.log('[Migration Check] ============================================');
        // Don't exit with error - let migration try to fix it
        process.exit(0);
    }
}

main()
    .catch((error) => {
        console.error('[Migration Check] Error:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

