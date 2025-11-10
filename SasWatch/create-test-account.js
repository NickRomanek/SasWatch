#!/usr/bin/env node
// Create Test Account Script
// Creates a test account with a known API key for testing

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function createTestAccount() {
    try {
        console.log('Creating test account...');
        
        // Create test account
        const testAccount = await prisma.account.create({
            data: {
                name: 'Test Account',
                email: 'test@example.com',
                apiKey: 'test-api-key-12345',
                subscriptionTier: 'Pro',
                isActive: true,
                password: await bcrypt.hash('testpassword', 10)
            }
        });
        
        console.log('✅ Test account created successfully!');
        console.log('Account ID:', testAccount.id);
        console.log('API Key:', testAccount.apiKey);
        console.log('Email:', testAccount.email);
        
        return testAccount;
    } catch (error) {
        if (error.code === 'P2002') {
            console.log('⚠️ Test account already exists');
            
            // Get existing account
            const existingAccount = await prisma.account.findUnique({
                where: { email: 'test@example.com' }
            });
            
            console.log('Using existing account:');
            console.log('Account ID:', existingAccount.id);
            console.log('API Key:', existingAccount.apiKey);
            
            return existingAccount;
        } else {
            console.error('❌ Error creating test account:', error);
            throw error;
        }
    }
}

async function testApiEndpoint(apiKey) {
    console.log('\nTesting API endpoint...');
    
    try {
        const testData = {
            event: 'test',
            url: 'test',
            clientId: 'test-client-id',
            windowsUser: 'testuser',
            userDomain: 'testdomain',
            computerName: 'TEST-PC',
            why: 'test',
            when: new Date().toISOString()
        };
        
        const response = await fetch('http://localhost:3000/api/track', {
            method: 'POST',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testData)
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('✅ API test successful!');
            console.log('Response:', result);
            return true;
        } else {
            const error = await response.text();
            console.log('❌ API test failed:', response.status, error);
            return false;
        }
    } catch (error) {
        console.error('❌ API test error:', error.message);
        return false;
    }
}

async function main() {
    try {
        const account = await createTestAccount();
        const apiTestPassed = await testApiEndpoint(account.apiKey);
        
        if (apiTestPassed) {
            console.log('\n🎉 All tests passed! Ready for monitoring script testing.');
            console.log('\nNext steps:');
            console.log('1. Run the monitoring script with this API key');
            console.log('2. Open Adobe Acrobat to test usage detection');
            console.log('3. Check the dashboard for incoming events');
        } else {
            console.log('\n⚠️ API test failed. Check server logs for details.');
        }
    } catch (error) {
        console.error('Test failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main();
}

module.exports = { createTestAccount, testApiEndpoint };
