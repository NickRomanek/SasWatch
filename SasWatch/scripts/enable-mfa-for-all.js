#!/usr/bin/env node
// Enable MFA for All Existing Accounts
// This script enables MFA for all accounts that don't have it enabled

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function enableMfaForAll() {
    try {
        console.log('Enabling MFA for all existing accounts...\n');
        
        // First, list all accounts
        const allAccounts = await prisma.account.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                mfaEnabled: true,
                isActive: true
            },
            orderBy: {
                createdAt: 'asc'
            }
        });
        
        console.log(`📊 Found ${allAccounts.length} total account(s):\n`);
        allAccounts.forEach((account, index) => {
            const mfaStatus = account.mfaEnabled ? '✅ Enabled' : '❌ Disabled';
            const activeStatus = account.isActive ? 'Active' : 'Inactive';
            console.log(`  ${index + 1}. ${account.name || 'Unnamed'} (${account.email})`);
            console.log(`     MFA: ${mfaStatus} | Status: ${activeStatus}`);
        });
        
        console.log('\n');
        
        // Update all accounts that don't have MFA enabled
        const accountsToUpdate = allAccounts.filter(a => !a.mfaEnabled && a.isActive);
        console.log(`🔄 Updating ${accountsToUpdate.length} account(s) that need MFA enabled...\n`);
        
        if (accountsToUpdate.length > 0) {
            accountsToUpdate.forEach(account => {
                console.log(`  - Enabling MFA for: ${account.name || 'Unnamed'} (${account.email})`);
            });
        }
        
        const result = await prisma.account.updateMany({
            where: { 
                mfaEnabled: false,
                isActive: true  // Only update active accounts
            },
            data: { 
                mfaEnabled: true 
            }
        });
        
        console.log(`\n✅ Enabled MFA for ${result.count} account(s)`);
        
        // Get updated counts
        const totalWithMfa = await prisma.account.count({
            where: { mfaEnabled: true }
        });
        
        const totalAccounts = await prisma.account.count();
        const activeAccounts = await prisma.account.count({
            where: { isActive: true }
        });
        
        console.log(`\n📊 Summary:`);
        console.log(`   Total accounts: ${totalAccounts}`);
        console.log(`   Active accounts: ${activeAccounts}`);
        console.log(`   Accounts with MFA enabled: ${totalWithMfa}`);
        
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

