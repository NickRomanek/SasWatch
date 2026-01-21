const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const email = 'nick@romatekai.com';
    console.log(`Promoting ${email} to Super Admin...`);
    try {
        const account = await prisma.account.update({
            where: { email: email },
            data: {
                isSuperAdmin: true,
                platformAdmin: true
            }
        });
        console.log('Success: Account updated to Super Admin.');
    } catch (e) {
        console.error('Error updating account:', e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
