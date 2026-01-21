const headlessManager = require('../lib/headless-manager');
const prisma = require('../lib/prisma');
const { encrypt } = require('../lib/encryption');

async function testConcurrency() {
    console.log('Testing Concurrency...');
    try {
        // Fetch a real account
        const account = await prisma.account.findFirst({
            where: { email: 'nick@romatekai.com' }
        });
        const accountId = account.id;

        // Ensure clean state with VALID encrypted data
        const sessionData = encrypt(JSON.stringify({ cookies: [] }));

        await prisma.headlessConnector.upsert({
            where: { accountId_vendor: { accountId, vendor: 'Mock' } },
            update: { status: 'active', sessionData: sessionData },
            create: { accountId, vendor: 'Mock', status: 'active', sessionData: sessionData }
        });

        console.log('Triggering 3 syncs simultaneously...');

        // Mock the collector execution time to be slow enough to overlap
        // We need to modify the MockCollector behavior or relies on its existing 2s delay

        const p1 = headlessManager.sync(accountId, 'Mock');
        const p2 = headlessManager.sync(accountId, 'Mock');
        const p3 = headlessManager.sync(accountId, 'Mock');

        try {
            await Promise.all([p1, p2, p3]);
            console.log('All syncs completed (unexpected).');
        } catch (e) {
            console.log('Parallel sync caught expected error:', e.message);
            if (e.message.includes('Sync already in progress')) {
                console.log('✓ Concurrency verification PASSED: Lock is working.');
            } else {
                console.error('FAILED: Unexpected error:', e);
            }
        }

        // Ideally, we want to know if they ALL ran or if some were queued/skipped.
        // We can't easily tell from here without inspecting logs, but if it doesn't crash, that's step 1.

        // Proper fix would require `HeadlessManager` to have a `syncing` state or lock.

    } catch (e) {
        console.error('Audit failed:', e);
    } finally {
        await prisma.$disconnect();
    }
}

testConcurrency();
