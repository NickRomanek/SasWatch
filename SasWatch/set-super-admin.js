#!/usr/bin/env node
// Set Super Admin Flag
// Updates an existing account to have isSuperAdmin = true

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function setSuperAdmin(email) {
    try {
        if (!email) {
            console.error('❌ Error: Email address is required');
            console.log('Usage: node set-super-admin.js <email>');
            console.log('Example: node set-super-admin.js user@example.com');
            process.exit(1);
        }

        console.log(`Looking up account with email: ${email}...`);
        
        // Find account by email
        const account = await prisma.account.findUnique({
            where: { email: email.toLowerCase().trim() }
        });
        
        if (!account) {
            console.error(`❌ Error: No account found with email: ${email}`);
            process.exit(1);
        }
        
        console.log(`Found account: ${account.name} (${account.email})`);
        console.log(`Current isSuperAdmin: ${account.isSuperAdmin}`);
        
        // Update account to set isSuperAdmin = true
        const updated = await prisma.account.update({
            where: { email: email.toLowerCase().trim() },
            data: { isSuperAdmin: true }
        });
        
        console.log('✅ Successfully set isSuperAdmin = true');
        console.log(`Account ID: ${updated.id}`);
        console.log(`Email: ${updated.email}`);
        console.log(`isSuperAdmin: ${updated.isSuperAdmin}`);
        console.log('\n📝 Important: Make sure your email is also in SUPER_ADMIN_EMAILS environment variable!');
        console.log('After updating both, restart your server and the dev/admin sections should appear.');
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.code === 'P2025') {
            console.error('Account not found. Please check the email address.');
        }
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
    console.error('❌ Error: Email address is required');
    console.log('\nUsage: node set-super-admin.js <email>');
    console.log('Example: node set-super-admin.js user@example.com');
    console.log('\nThis will set isSuperAdmin = true for the specified account.');
    process.exit(1);
}

setSuperAdmin(email);

