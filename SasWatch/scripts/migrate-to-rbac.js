#!/usr/bin/env node
/**
 * RBAC Migration Script
 * 
 * Migrates existing accounts to the new RBAC system by:
 * 1. Creating an AccountMember with role 'owner' for each Account
 * 2. Copying auth fields (password, MFA, email verification) from Account to AccountMember
 * 3. Setting platformAdmin = isSuperAdmin for backward compatibility
 * 
 * Run with: node scripts/migrate-to-rbac.js [--dry-run]
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');

async function migrateToRbac() {
    console.log('='.repeat(60));
    console.log('RBAC Migration Script');
    console.log('='.repeat(60));
    
    if (DRY_RUN) {
        console.log('\n⚠️  DRY RUN MODE - No changes will be made\n');
    }
    
    try {
        // Get all accounts
        const accounts = await prisma.account.findMany({
            select: {
                id: true,
                name: true,
                email: true,
                password: true,
                isActive: true,
                isSuperAdmin: true,
                platformAdmin: true,
                emailVerified: true,
                emailVerificationToken: true,
                emailVerificationExpires: true,
                passwordResetToken: true,
                passwordResetExpires: true,
                mfaEnabled: true,
                mfaSecret: true,
                mfaBackupCodes: true,
                mfaMethod: true,
                createdAt: true,
                lastLoginAt: true
            }
        });
        
        console.log(`Found ${accounts.length} account(s) to process\n`);
        
        let created = 0;
        let skipped = 0;
        let platformAdminUpdated = 0;
        let errors = 0;
        
        for (const account of accounts) {
            console.log(`Processing: ${account.name} (${account.email})`);
            
            // Check if AccountMember already exists for this email
            const existingMember = await prisma.accountMember.findUnique({
                where: { email: account.email.toLowerCase().trim() }
            });
            
            if (existingMember) {
                console.log(`  ⏭️  Member already exists for ${account.email}`);
                skipped++;
            } else {
                if (!DRY_RUN) {
                    try {
                        // Create AccountMember as owner
                        const member = await prisma.accountMember.create({
                            data: {
                                accountId: account.id,
                                email: account.email.toLowerCase().trim(),
                                password: account.password || '', // Might be null in new accounts
                                name: account.name,
                                role: 'owner',
                                isActive: account.isActive,
                                emailVerified: account.emailVerified,
                                emailVerificationToken: account.emailVerificationToken,
                                emailVerificationExpires: account.emailVerificationExpires,
                                passwordResetToken: account.passwordResetToken,
                                passwordResetExpires: account.passwordResetExpires,
                                mfaEnabled: account.mfaEnabled,
                                mfaSecret: account.mfaSecret,
                                mfaBackupCodes: account.mfaBackupCodes,
                                mfaMethod: account.mfaMethod,
                                lastLoginAt: account.lastLoginAt,
                                createdAt: account.createdAt
                            }
                        });
                        
                        console.log(`  ✅ Created member: ${member.email} (role: owner)`);
                        created++;
                    } catch (error) {
                        console.error(`  ❌ Error creating member: ${error.message}`);
                        errors++;
                    }
                } else {
                    console.log(`  📝 Would create member: ${account.email} (role: owner)`);
                    created++;
                }
            }
            
            // Update platformAdmin flag if needed
            if (account.isSuperAdmin && !account.platformAdmin) {
                if (!DRY_RUN) {
                    await prisma.account.update({
                        where: { id: account.id },
                        data: { platformAdmin: true }
                    });
                    console.log(`  🔑 Set platformAdmin = true (was isSuperAdmin)`);
                } else {
                    console.log(`  📝 Would set platformAdmin = true (was isSuperAdmin)`);
                }
                platformAdminUpdated++;
            }
            
            console.log('');
        }
        
        console.log('='.repeat(60));
        console.log('Migration Summary');
        console.log('='.repeat(60));
        console.log(`Total accounts:     ${accounts.length}`);
        console.log(`Members created:    ${created}`);
        console.log(`Members skipped:    ${skipped}`);
        console.log(`Platform admins:    ${platformAdminUpdated}`);
        console.log(`Errors:             ${errors}`);
        
        if (DRY_RUN) {
            console.log('\n⚠️  This was a dry run. Run without --dry-run to apply changes.');
        } else {
            console.log('\n✅ Migration complete!');
        }
        
    } catch (error) {
        console.error('\n❌ Migration failed:', error);
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run migration
migrateToRbac()
    .then(() => {
        process.exit(0);
    })
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });

