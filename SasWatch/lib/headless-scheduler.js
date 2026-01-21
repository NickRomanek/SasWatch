const cron = require('node-cron');
const { PrismaClient } = require('@prisma/client');
const headlessManager = require('./headless-manager');

const prisma = new PrismaClient();

// Run every 6 hours
const SYNC_SCHEDULE = '0 */6 * * *';

async function syncAllHeadlessConnectors() {
    const startTime = new Date();
    console.log(`[Headless Scheduler] Starting sync at ${startTime.toISOString()}`);

    try {
        // Find all active connectors
        const connectors = await prisma.headlessConnector.findMany({
            where: {
                // We sync active connectors, and maybe retry errors if they haven't been failing for too long
                // For simplicity, just sync 'active' ones.
                status: 'active'
            }
        });

        console.log(`[Headless Scheduler] Found ${connectors.length} active connectors`);

        let successCount = 0;
        let failCount = 0;

        // Process sequentially to avoid memory spikes from multiple browser instances
        for (const connector of connectors) {
            try {
                console.log(`[Headless Scheduler] Syncing ${connector.vendor} for account ${connector.accountId}...`);

                await headlessManager.sync(connector.accountId, connector.vendor);

                successCount++;
                console.log(`[Headless Scheduler] ✓ Sync success: ${connector.vendor} (${connector.accountId})`);
            } catch (error) {
                failCount++;
                console.error(`[Headless Scheduler] ✗ Sync failed: ${connector.vendor} (${connector.accountId}) - ${error.message}`);
                // Note: headlessManager.sync handles updating the status to 'error' in DB
            }

            // Wait a bit between syncs (30 seconds)
            await new Promise(resolve => setTimeout(resolve, 30000));
        }

        const duration = new Date() - startTime;
        console.log(`[Headless Scheduler] Completed in ${duration}ms: ${successCount} success, ${failCount} failed`);

    } catch (error) {
        console.error('[Headless Scheduler] Fatal error:', error);
    }
}

function startHeadlessScheduler() {
    const enabled = process.env.ENABLE_HEADLESS_SYNC !== 'false';

    if (!enabled) {
        console.log('[Headless Scheduler] Disabled via ENABLE_HEADLESS_SYNC env var');
        return;
    }

    console.log(`[Headless Scheduler] Scheduling: ${SYNC_SCHEDULE} (every 6 hours)`);

    // Schedule the job
    cron.schedule(SYNC_SCHEDULE, syncAllHeadlessConnectors);

    // Run initial sync check 5 minutes after server start to allow other services to settle
    // and to not block fast startup
    if (process.env.NODE_ENV === 'production') {
        setTimeout(() => {
            console.log('[Headless Scheduler] Running initial sync check...');
            syncAllHeadlessConnectors();
        }, 300000); // 5 minutes
    }
}

module.exports = {
    startHeadlessScheduler,
    syncAllHeadlessConnectors
};
