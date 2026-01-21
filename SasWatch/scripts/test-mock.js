const headlessManager = require('../lib/headless-manager');
const prisma = require('../lib/prisma');

async function testMock() {
    console.log('Testing Mock Connector...');
    try {
        // Fetch a real account to pass FK constraint
        const account = await prisma.account.findFirst({
            where: { email: 'nick@romatekai.com' } // Using the known admin email
        });

        if (!account) {
            throw new Error('Test account not found');
        }

        const accountId = account.id;

        // 1. "Connect" (Capture Session)
        // This should hit the mock logic and return immediately without a browser
        await headlessManager.captureSession(accountId, 'Mock');
        console.log('✓ Capture Session (Mock) passed');

        // 2. Verify DB state after capture
        let connector = await prisma.headlessConnector.findFirst({
            where: { accountId: accountId, vendor: 'Mock' }
        });

        if (!connector || connector.status !== 'active') {
            throw new Error(`DB verification failed. Status: ${connector?.status}`);
        }
        console.log('✓ DB Record Active');

        // 3. Sync
        console.log('Running Sync...');
        const result = await headlessManager.sync(accountId, 'Mock');
        console.log('Sync Result:', result);

        if (result.users.length > 0 && result.licenses.length > 0) {
            console.log('✓ Mock Sync returned data');
        } else {
            throw new Error('Mock Sync failed to return data');
        }

        // Cleanup
        await prisma.headlessConnector.deleteMany({
            where: { accountId: accountId, vendor: 'Mock' }
        });
        console.log('✓ Cleanup complete');

    } catch (e) {
        console.error('TEST FAILED:', e);
    } finally {
        await prisma.$disconnect();
    }
}

testMock();
