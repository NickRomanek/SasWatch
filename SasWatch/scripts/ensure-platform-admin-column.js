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
        console.log('[Migration Check] platformAdmin column exists ✓');
        return true;
    } catch (error) {
        if (error.code === 'P2022' || error.message?.includes('does not exist')) {
            console.log('[Migration Check] platformAdmin column missing, adding it...');
            try {
                // Add the column directly
                await prisma.$executeRaw`
                    ALTER TABLE "accounts" 
                    ADD COLUMN IF NOT EXISTS "platformAdmin" BOOLEAN NOT NULL DEFAULT false;
                `;
                console.log('[Migration Check] ✓ Added platformAdmin column');
                return true;
            } catch (addError) {
                console.error('[Migration Check] ✗ Failed to add platformAdmin column:', addError.message);
                return false;
            }
        }
        // Some other error
        console.error('[Migration Check] Unexpected error:', error.message);
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
            console.log('[Migration Check] account_members table missing (will be created by migration)');
            // Don't create it here - let the migration handle it
            return false;
        }
        return true; // Table exists or different error
    }
}

async function main() {
    console.log('[Migration Check] Checking database schema...');
    
    const platformAdminOk = await ensurePlatformAdminColumn();
    const accountMembersOk = await ensureAccountMembersTable();
    
    if (platformAdminOk) {
        console.log('[Migration Check] ✓ Database schema is ready');
        process.exit(0);
    } else {
        console.log('[Migration Check] ⚠️  Some columns may be missing. Migration should fix this.');
        // Don't exit with error - let the app start and migration will fix it
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

