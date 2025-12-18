const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const { syncEntraSignInsIfNeeded, syncEntraUsersIfNeeded } = require('./database-multitenant');

const prisma = new PrismaClient();

// Run every 30 minutes for better real-time sync
const SYNC_SCHEDULE = '*/30 * * * *'; // Every 30 minutes

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

        // ✅ IMPROVED: Sync accounts in parallel with rate limiting
        // Process in batches of 3 to avoid overwhelming Graph API
        const BATCH_SIZE = 3;
        let processed = 0;

        for (let i = 0; i < accounts.length; i += BATCH_SIZE) {
            const batch = accounts.slice(i, i + BATCH_SIZE);
            console.log(`[Background Sync] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(accounts.length / BATCH_SIZE)} (${batch.length} accounts)`);

            // Process batch in parallel with timeout protection
            const batchPromises = batch.map(async (account) => {
                // Wrap in a timeout to prevent hanging forever
                const syncTimeout = new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error('Background sync timed out after 2 minutes'));
                    }, 120000); // 2 minute timeout per account sync
                });

                try {
                    // Race the sync against the timeout
                    const syncPromise = (async () => {
                        // Sync sign-ins with reduced date range and shorter timeout
                        const signInResult = await syncEntraSignInsIfNeeded(account.id, {
                            force: true,  // Override throttle for background sync
                            maxPages: 3,  // Reduced from 5 to limit data
                            backfillHours: 24,  // Limit to 24 hours instead of default
                            timeout: 60000  // 60 second timeout for background syncs
                        });

                        // Sync users (less frequent, but keeps user data fresh)
                        const userResult = await syncEntraUsersIfNeeded(account.id, {
                            force: false  // Respect 1-hour throttle for users
                        });

                        return {
                            account,
                            signInResult,
                            userResult,
                            success: true
                        };
                    })();

                    return await Promise.race([syncPromise, syncTimeout]);
                } catch (error) {
                    // Log but don't crash - background syncs should be resilient
                    console.error(`[Background Sync] Error syncing ${account.email}:`, error.message);
                    return {
                        account,
                        error: error.message,
                        success: false
                    };
                }
            });

            // Wait for batch with timeout protection
            try {
                const batchResults = await Promise.allSettled(batchPromises);
                
                // Process results
                for (const settledResult of batchResults) {
                    processed++;
                    if (settledResult.status === 'fulfilled') {
                        const result = settledResult.value;
                        if (result.success) {
                            const { signInResult, userResult } = result;
                            if (signInResult.synced || userResult.synced) {
                                successCount++;
                                totalSignIns += signInResult.count || 0;
                                totalUsers += userResult.count || 0;
                                console.log(`[Background Sync] ✓ ${result.account.email}: ${signInResult.count || 0} sign-ins, ${userResult.count || 0} users`);
                            } else {
                                console.log(`[Background Sync] ○ ${result.account.email}: ${signInResult.reason || userResult.reason}`);
                            }
                        } else {
                            failCount++;
                            console.error(`[Background Sync] ✗ ${result.account.email}:`, result.error);
                        }
                    } else {
                        failCount++;
                        console.error(`[Background Sync] ✗ Batch promise rejected:`, settledResult.reason);
                    }
                }
            } catch (batchError) {
                console.error(`[Background Sync] Batch processing error:`, batchError);
                failCount += batch.length;
            }

            // Rate limiting between batches (1 second)
            if (i + BATCH_SIZE < accounts.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        const duration = new Date() - startTime;
        console.log(`[Background Sync] Completed in ${duration}ms: ${successCount} success, ${failCount} failed, ${totalSignIns} sign-ins, ${totalUsers} users`);
    } catch (error) {
        console.error('[Background Sync] Fatal error:', error);
        // Don't throw - background sync failures shouldn't crash the app
    }
}

function startBackgroundSync() {
    const enabled = process.env.ENABLE_BACKGROUND_SYNC !== 'false';
    
    if (!enabled) {
        console.log('[Background Sync] Disabled via ENABLE_BACKGROUND_SYNC env var');
        return;
    }
    
    console.log(`[Background Sync] Scheduling: ${SYNC_SCHEDULE} (every 30 minutes)`);
    
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

