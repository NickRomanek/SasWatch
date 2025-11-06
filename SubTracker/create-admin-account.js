#!/usr/bin/env node
// Create Admin Account Script
// Creates admin account: admin@romatekai.com

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createAdminAccount() {
    try {
        console.log('Creating admin account...');
        
        const email = 'admin@romatekai.com';
        const password = 'password';
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Check if account already exists
        const existingAccount = await prisma.account.findUnique({
            where: { email: email }
        });
        
        if (existingAccount) {
            console.log('⚠️ Admin account already exists');
            console.log('Account ID:', existingAccount.id);
            console.log('API Key:', existingAccount.apiKey);
            console.log('Email:', existingAccount.email);
            
            // Update password in case it was changed
            await prisma.account.update({
                where: { email: email },
                data: { password: hashedPassword }
            });
            console.log('✅ Password updated');
            
            return existingAccount;
        }
        
        // Create new account
        const adminAccount = await prisma.account.create({
            data: {
                name: 'RomaTek AI',
                email: email,
                password: hashedPassword,
                subscriptionTier: 'enterprise',
                isActive: true
            }
        });
        
        console.log('✅ Admin account created successfully!');
        console.log('Account ID:', adminAccount.id);
        console.log('API Key:', adminAccount.apiKey);
        console.log('Email:', adminAccount.email);
        console.log('Name:', adminAccount.name);
        
        return adminAccount;
    } catch (error) {
        console.error('❌ Error creating admin account:', error);
        throw error;
    }
}

async function main() {
    try {
        await createAdminAccount();
        console.log('\n✅ Setup complete!');
        console.log('You can now login at http://localhost:3000/login');
        console.log('Email: admin@romatekai.com');
        console.log('Password: password');
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

module.exports = { createAdminAccount };

