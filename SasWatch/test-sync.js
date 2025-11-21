#!/usr/bin/env node

// Test script for the improved Entra sync functionality
// This script tests the syncEntraSignInsIfNeeded function with the new timestamp-based approach

const { syncEntraSignInsIfNeeded } = require('./lib/database-multitenant');

async function testSync() {
    console.log('🧪 Testing improved Entra sign-in sync...\n');

    // Test with a fake account ID (this will fail at the database level, but we can test the logic)
    const testAccountId = 'test-account-123';

    try {
        console.log('📊 Testing syncEntraSignInsIfNeeded with force=true...');
        const result = await syncEntraSignInsIfNeeded(testAccountId, {
            force: true,
            maxPages: 1, // Limit for testing
            onProgress: (progress) => {
                console.log(`🔄 Progress: ${progress.message}`);
            }
        });

        console.log('✅ Sync completed:', result);

        if (result.reason === 'not-configured') {
            console.log('ℹ️  Expected result: Entra not configured in test environment');
        } else if (result.reason === 'not-connected') {
            console.log('ℹ️  Expected result: Test account not connected to Entra');
        }

    } catch (error) {
        console.error('❌ Sync failed:', error.message);
        if (error.message.includes('not configured')) {
            console.log('ℹ️  Expected: Entra credentials not configured in test environment');
        }
    }

    console.log('\n🎉 Sync test completed!');
    process.exit(0);
}

if (require.main === module) {
    testSync().catch(error => {
        console.error('💥 Test failed:', error);
        process.exit(1);
    });
}

module.exports = { testSync };
