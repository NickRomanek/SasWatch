#!/usr/bin/env node
// Enable MFA for All Existing Accounts
// This script enables MFA for all accounts that don't have it enabled

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function enableMfaForAll() {
    try {
        console.log('Enabling MFA for all existing accounts...');
        
        // Update all accounts that don't have MFA enabled
        const result = await prisma.account.updateMany({
            where: { 
                mfaEnabled: false 
            },
            data: { 
                mfaEnabled: true 
            }
        });
        
        console.log(`✅ Enabled MFA for ${result.count} account(s)`);
        
        // Get total count of accounts with MFA enabled
        const totalWithMfa = await prisma.account.count({
            where: { mfaEnabled: true }
        });
        
        const totalAccounts = await prisma.account.count();
        
        console.log(`📊 Total accounts: ${totalAccounts}`);
        console.log(`🔐 Accounts with MFA enabled: ${totalWithMfa}`);
        
        return result;
    } catch (error) {
        console.error('❌ Error enabling MFA:', error);
        throw error;
    }
}

async function main() {
    try {
        await enableMfaForAll();
        console.log('\n✅ MFA enablement complete!');
    } catch (error) {
        console.error('Failed:', error);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = { enableMfaForAll };

