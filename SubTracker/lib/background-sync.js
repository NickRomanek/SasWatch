const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { syncEntraSignInsIfNeeded, syncEntraUsersIfNeeded } = require('./database-multitenant');

const prisma = new PrismaClient();

// Run every 6 hours to stay within Azure's 7-day retention
const SYNC_SCHEDULE = '0 */6 * * *'; // At minute 0 past every 6th hour

async function syncAllAccounts() {
    const startTime = new Date();
    console.log(`[Background Sync] Starting at ${startTime.toISOString()}`);
    
    try {
        // Get all accounts with Entra integration
        const accounts = await prisma.account.findMany({
            where: {
                entraTenantId: { not: null }
            },
            select: {
                id: true,
                email: true,
                entraTenantId: true
            }
        });

        console.log(`[Background Sync] Found ${accounts.length} accounts with Entra integration`);

        let successCount = 0;
        let failCount = 0;
        let totalSignIns = 0;
        let totalUsers = 0;

        // Sync each account sequentially
        for (const account of accounts) {
            try {
                // Sync sign-ins
                const signInResult = await syncEntraSignInsIfNeeded(account.id, { 
                    force: true,  // Override throttle
                    maxPages: 10  // Limit to ~1000 events per sync
                });
                
                // Sync users (less frequent, but keeps user data fresh)
                const userResult = await syncEntraUsersIfNeeded(account.id, {
                    force: false  // Respect 1-hour throttle for users
                });
                
                if (signInResult.synced || userResult.synced) {
                    successCount++;
                    totalSignIns += signInResult.count || 0;
                    totalUsers += userResult.count || 0;
                    console.log(`[Background Sync] ✓ ${account.email}: ${signInResult.count || 0} sign-ins, ${userResult.count || 0} users`);
                } else {
                    console.log(`[Background Sync] ○ ${account.email}: ${signInResult.reason || userResult.reason}`);
                }
            } catch (error) {
                failCount++;
                console.error(`[Background Sync] ✗ ${account.email}:`, error.message);
            }
        }

        const duration = new Date() - startTime;
        console.log(`[Background Sync] Completed in ${duration}ms: ${successCount} success, ${failCount} failed, ${totalSignIns} sign-ins, ${totalUsers} users`);
    } catch (error) {
        console.error('[Background Sync] Fatal error:', error);
    }
}

function startBackgroundSync() {
    const enabled = process.env.ENABLE_BACKGROUND_SYNC !== 'false';
    
    if (!enabled) {
        console.log('[Background Sync] Disabled via ENABLE_BACKGROUND_SYNC env var');
        return;
    }
    
    console.log(`[Background Sync] Scheduling: ${SYNC_SCHEDULE} (every 6 hours)`);
    
    // Schedule the job
    cron.schedule(SYNC_SCHEDULE, syncAllAccounts);
    
    // Run initial sync 2 minutes after server start
    setTimeout(() => {
        console.log('[Background Sync] Running initial sync...');
        syncAllAccounts();
    }, 120000); // 2 minutes
}

module.exports = {
    startBackgroundSync,
    syncAllAccounts // Export for manual testing
};

