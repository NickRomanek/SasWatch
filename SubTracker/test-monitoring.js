#!/usr/bin/env node
// Test Monitoring Script
// Tests if the monitoring script is working by sending test data

const axios = require('axios');

async function testMonitoringScript() {
    console.log('🧪 Testing monitoring script...');
    
    try {
        const testData = {
            event: 'manual_test',
            url: 'test',
            clientId: 'manual-test',
            windowsUser: 'testuser',
            userDomain: 'testdomain',
            computerName: 'TEST-PC',
            why: 'manual_test',
            when: new Date().toISOString()
        };
        
        const response = await axios.post('http://localhost:3000/api/track', testData, {
            headers: {
                'X-API-Key': 'test-api-key-12345',
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ API test successful!');
        console.log('Response:', response.data);
        return true;
    } catch (error) {
        console.error('❌ API test error:', error.message);
        return false;
    }
}

async function checkRecentEvents() {
    console.log('\n📊 Checking recent events...');
    
    try {
        // This would normally require authentication, but for testing we'll just check if the server is responding
        const response = await axios.get('http://localhost:3000/');
        
        console.log('✅ Server is responding');
        return true;
    } catch (error) {
        console.error('❌ Server check error:', error.message);
        return false;
    }
}

async function main() {
    console.log('🚀 Starting monitoring script tests\n');
    
    const apiTest = await testMonitoringScript();
    const serverTest = await checkRecentEvents();
    
    console.log('\n📊 Test Results:');
    console.log('================');
    console.log(`API Test: ${apiTest ? '✅ PASSED' : '❌ FAILED'}`);
    console.log(`Server Test: ${serverTest ? '✅ PASSED' : '❌ FAILED'}`);
    
    if (apiTest && serverTest) {
        console.log('\n🎉 All tests passed!');
        console.log('\nNext steps:');
        console.log('1. Open Adobe Acrobat to test usage detection');
        console.log('2. Check the dashboard at http://localhost:3000');
        console.log('3. Look for usage events in the dashboard');
    } else {
        console.log('\n⚠️ Some tests failed. Check the issues above.');
    }
}

main().catch(console.error);
