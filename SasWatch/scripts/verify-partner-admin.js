const partnerDb = require('../lib/partner-database');
const prisma = require('../lib/prisma');
const auth = require('../lib/auth');

async function runVerification() {
    console.log('🚀 Starting Partner Management Verification...');

    try {
        // 1. Create a test account to become a partner
        const partnerAccount = await auth.createAccount('Partner Test', 'partner@test.com', 'Password123!');
        console.log('✅ Created partner account:', partnerAccount.id);

        // 2. Create a test account to be linked
        const linkedAccount = await auth.createAccount('Client Test', 'client@test.com', 'Password123!');
        console.log('✅ Created client account:', linkedAccount.id);

        // 3. Make the first account a partner
        const partner = await partnerDb.createPartnerAccount(partnerAccount.id, {
            companyName: 'Test MSP',
            maxLinkedAccounts: 5
        });
        console.log('✅ Promoted to partner:', partner.id);
        console.log('   Partner API Key:', partner.partnerApiKey);

        // 4. Link the second account to the partner
        const link = await partnerDb.linkAccountToPartner(partner.id, linkedAccount.id, {
            nickname: 'First Client'
        });
        console.log('✅ Linked account to partner');

        // 5. Verify partner can see linked account
        const allPartners = await partnerDb.getAllPartners();
        const testPartner = allPartners.find(p => p.id === partner.id);
        console.log('✅ Partner found in list:', !!testPartner);
        console.log('   Linked accounts count:', testPartner._count.linkedAccounts);

        // 6. Get partner details
        const details = await partnerDb.getPartnerById(partner.id);
        console.log('✅ Partner details fetched, links:', details.linkedAccounts.length);

        // 7. Regenerate API Key
        const oldKey = partner.partnerApiKey;
        const newKey = await partnerDb.regeneratePartnerApiKey(partner.id);
        console.log('✅ API Key regenerated');
        console.log('   Old:', oldKey);
        console.log('   New:', newKey);

        // 8. Unlink account
        await partnerDb.unlinkAccountFromPartner(partner.id, linkedAccount.id);
        console.log('✅ Unlinked account');

        // 9. Cleanup
        await prisma.partnerAccountLink.deleteMany({ where: { partnerAccountId: partner.id } });
        await prisma.partnerAccount.delete({ where: { id: partner.id } });
        await prisma.account.delete({ where: { id: partnerAccount.id } });
        await prisma.account.delete({ where: { id: linkedAccount.id } });
        console.log('🛡️ Cleanup complete.');

        console.log('\n✨ ALL BACKEND TESTS PASSED!');
    } catch (error) {
        console.error('❌ Verification failed:', error);
        process.exit(1);
    }
}

runVerification();
