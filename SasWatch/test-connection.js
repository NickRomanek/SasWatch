/**
 * Test script to verify Azure AD connection and permissions
 * Run with: node test-connection.js
 */

require('dotenv').config();
const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');

async function testConnection() {
    console.log('🔍 Testing SubTracker Azure AD Connection...\n');
    
    // Check environment variables
    const requiredEnvVars = ['CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
        console.error('❌ Missing required environment variables:');
        missingVars.forEach(varName => console.error(`   - ${varName}`));
        console.error('\nPlease check your .env file and ensure all required variables are set.');
        return false;
    }
    
    console.log('✅ Environment variables loaded');
    console.log(`   - Client ID: ${process.env.CLIENT_ID.substring(0, 8)}...`);
    console.log(`   - Tenant ID: ${process.env.TENANT_ID}`);
    console.log(`   - Client Secret: ${process.env.CLIENT_SECRET ? 'Set' : 'Missing'}\n`);
    
    try {
        // Test MSAL configuration
        console.log('🔐 Testing MSAL authentication...');
        
        const msalConfig = {
            auth: {
                clientId: process.env.CLIENT_ID,
                clientSecret: process.env.CLIENT_SECRET,
                authority: `https://login.microsoftonline.com/${process.env.TENANT_ID}`
            }
        };
        
        const cca = new ConfidentialClientApplication(msalConfig);
        console.log('✅ MSAL configuration successful');
        
        // Test token acquisition
        console.log('🎫 Testing token acquisition...');
        
        const clientCredentialRequest = {
            scopes: ['https://graph.microsoft.com/.default'],
        };
        
        const response = await cca.acquireTokenByClientCredential(clientCredentialRequest);
        console.log('✅ Token acquired successfully');
        console.log(`   - Token expires: ${new Date(response.expiresOn).toLocaleString()}\n`);
        
        // Test Graph API connection
        console.log('📊 Testing Microsoft Graph API connection...');
        
        const graphClient = Client.init({
            authProvider: (done) => {
                done(null, response.accessToken);
            }
        });
        
        // Test user reading permission
        console.log('👥 Testing User.Read.All permission...');
        try {
            const users = await graphClient.api('/users').top(1).select('id,displayName').get();
            console.log('✅ User.Read.All permission working');
            console.log(`   - Found ${users['@odata.count'] || 'unknown'} total users`);
            if (users.value && users.value.length > 0) {
                console.log(`   - Sample user: ${users.value[0].displayName}`);
            }
        } catch (error) {
            console.error('❌ User.Read.All permission failed:', error.message);
        }
        
        // Test audit log reading permission
        console.log('📋 Testing AuditLog.Read.All permission...');
        try {
            const auditLogs = await graphClient.api('/auditLogs/signIns').top(1).get();
            console.log('✅ AuditLog.Read.All permission working');
            console.log(`   - Found sign-in logs (showing recent activity)`);
        } catch (error) {
            console.error('❌ AuditLog.Read.All permission failed:', error.message);
        }
        
        // Test directory reading permission
        console.log('📁 Testing Directory.Read.All permission...');
        try {
            const directory = await graphClient.api('/organization').get();
            console.log('✅ Directory.Read.All permission working');
            console.log(`   - Organization: ${directory.value[0].displayName}`);
        } catch (error) {
            console.error('❌ Directory.Read.All permission failed:', error.message);
        }
        
        console.log('\n🎉 Connection test completed successfully!');
        console.log('Your SubTracker application should work properly now.');
        console.log('\nTo start the application, run: npm start');
        
        return true;
        
    } catch (error) {
        console.error('❌ Connection test failed:', error.message);
        
        if (error.message.includes('AADSTS')) {
            console.error('\n🔧 This looks like an Azure AD error. Please check:');
            console.error('   - Your app registration exists and is configured correctly');
            console.error('   - API permissions are granted with admin consent');
            console.error('   - Client secret hasn\'t expired');
            console.error('   - Tenant ID is correct');
        }
        
        return false;
    }
}

// Run the test
if (require.main === module) {
    testConnection().then(success => {
        process.exit(success ? 0 : 1);
    });
}

module.exports = testConnection;
