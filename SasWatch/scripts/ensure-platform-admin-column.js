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
            console.log('[Migration Check] account_members table missing (will be created by migration)');
            // Don't create it here - let the migration handle it
            return false;
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
        if (platformAdminOk) {
            console.log('[Migration Check] ✓ Database schema is ready');
        } else {
            console.log('[Migration Check] ⚠️  Some columns may be missing. Migration will attempt to fix this.');
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

