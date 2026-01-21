const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkStatus() {
    try {
        const connectors = await prisma.headlessConnector.findMany({
            include: { account: true }
        });
        console.log('Connectors found:', connectors.length);
        connectors.forEach(c => {
            console.log(`- Vendor: ${c.vendor}, Status: ${c.status}, Last Sync: ${c.lastSyncAt}`);
            console.log(`  Session Data Present: ${!!c.sessionData}`);
            console.log(`  Account: ${c.account.email}`);
        });
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkStatus();
