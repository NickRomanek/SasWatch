const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const email = 'nick@romatekai.com';
    console.log(`Checking ${email}...`);
    const account = await prisma.account.findUnique({ where: { email } });
    if (!account) { console.log('Account NOT found'); return; }

    console.log('Account:', {
        id: account.id,
        email: account.email,
        isSuperAdmin: account.isSuperAdmin,
        platformAdmin: account.platformAdmin
    });

    // Check raw
    try {
        const raw = await prisma.$queryRaw`SELECT "isSuperAdmin", "platformAdmin" FROM accounts WHERE email = ${email}`;
        console.log('Raw:', raw);
    } catch (e) {
        console.log('Raw query failed:', e.message);
    }
}
main();
