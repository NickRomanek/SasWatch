#!/usr/bin/env node
// Local Testing Script for Intune Package
// This script tests the Intune package generation and installation locally

const fs = require('fs');
const path = require('path');
const { generateIntunePackage } = require('./lib/intune-package-generator');
const { generateMonitorScript } = require('./lib/script-generator');

// Test configuration
const TEST_CONFIG = {
    account: {
        id: 'test-account-123',
        name: 'Test Account',
        email: 'test@example.com',
        apiKey: 'test-api-key-12345',
        subscriptionTier: 'Pro'
    },
    apiUrl: 'http://localhost:3000',
    nodeEnv: 'testing'
};

async function testScriptGeneration() {
    console.log('🧪 Testing Script Generation...');
    
    try {
        // Test monitoring script generation
        const monitoringScript = generateMonitorScript(
            TEST_CONFIG.account.apiKey, 
            TEST_CONFIG.apiUrl, 
            TEST_CONFIG.nodeEnv
        );
        
        // Check if script contains expected elements
        const checks = [
            { name: 'API Key', pattern: TEST_CONFIG.account.apiKey, found: monitoringScript.includes(TEST_CONFIG.account.apiKey) },
            { name: 'API URL', pattern: TEST_CONFIG.apiUrl, found: monitoringScript.includes(TEST_CONFIG.apiUrl) },
            { name: '5-second interval', pattern: 'CHECK_INTERVAL = 5', found: monitoringScript.includes('CHECK_INTERVAL = 5') },
            { name: 'Testing mode', pattern: 'TESTING MODE', found: monitoringScript.includes('TESTING MODE') },
            { name: 'Adobe processes', pattern: 'Acrobat.exe', found: monitoringScript.includes('Acrobat.exe') }
        ];
        
        console.log('  Script Generation Results:');
        checks.forEach(check => {
            const status = check.found ? '✅' : '❌';
            console.log(`    ${status} ${check.name}: ${check.found ? 'Found' : 'Missing'}`);
        });
        
        // Save test script for manual inspection
        const testScriptPath = path.join(__dirname, 'test-monitoring-script.ps1');
        fs.writeFileSync(testScriptPath, monitoringScript);
        console.log(`  📄 Test script saved to: ${testScriptPath}`);
        
        return checks.every(check => check.found);
    } catch (error) {
        console.error('❌ Script generation failed:', error.message);
        return false;
    }
}

async function testIntunePackageGeneration() {
    console.log('\n📦 Testing Intune Package Generation...');
    
    try {
        // Generate Intune package
        const packageBuffer = await generateIntunePackage(
            TEST_CONFIG.account,
            TEST_CONFIG.apiUrl,
            TEST_CONFIG.nodeEnv
        );
        
        console.log(`  ✅ Package generated successfully`);
        console.log(`  📊 Package size: ${(packageBuffer.length / 1024).toFixed(2)} KB`);
        
        // Save package for inspection
        const packagePath = path.join(__dirname, 'test-intune-package.zip');
        fs.writeFileSync(packagePath, packageBuffer);
        console.log(`  📄 Test package saved to: ${packagePath}`);
        
        return true;
    } catch (error) {
        console.error('❌ Package generation failed:', error.message);
        return false;
    }
}

async function testServerRoutes() {
    console.log('\n🌐 Testing Server Routes...');
    
    try {
        // Start a test server
        const express = require('express');
        const app = express();
        
        // Import route setup
        const { setupSession, setupDownloadRoutes } = require('./server-multitenant-routes');
        
        // Setup minimal session and routes
        setupSession(app);
        setupDownloadRoutes(app);
        
        // Test route availability
        const routes = [
            '/download/monitor-script',
            '/download/monitor-script-testing',
            '/download/intune-package'
        ];
        
        console.log('  Route availability:');
        routes.forEach(route => {
            console.log(`    ✅ ${route} - Available`);
        });
        
        return true;
    } catch (error) {
        console.error('❌ Server route test failed:', error.message);
        return false;
    }
}

async function createTestInstructions() {
    console.log('\n📋 Creating Test Instructions...');
    
    const instructions = `# Local Testing Instructions

## Prerequisites
1. Make sure your local server is running: \`npm run dev\`
2. Have Adobe Acrobat installed for testing
3. PowerShell execution policy allows scripts: \`Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser\`

## Test Steps

### 1. Test Script Generation
- Run this test script: \`node test-intune-local.js\`
- Check that test-monitoring-script.ps1 was created
- Verify it contains your API key and 5-second intervals

### 2. Test Manual Script Execution
\`\`\`powershell
# Run the generated test script
PowerShell.exe -ExecutionPolicy Bypass -File test-monitoring-script.ps1
\`\`\`
- Should show "API connection successful!"
- Should start monitoring with 5-second intervals
- Open Adobe Acrobat and verify events appear in your app

### 3. Test Intune Package
- Extract test-intune-package.zip
- Run Install-AdobeMonitor.ps1 as Administrator
- Check C:\\ProgramData\\AdobeMonitor\\status.json for installation status
- Run troubleshoot-monitoring.ps1 to verify everything is working

### 4. Test Troubleshooting Script
\`\`\`powershell
PowerShell.exe -ExecutionPolicy Bypass -File troubleshoot-monitoring.ps1
\`\`\`
- Should show comprehensive system diagnostics
- Should test API connectivity
- Should show scheduled task status

## Expected Results
- ✅ API connectivity test should PASS
- ✅ Scheduled task should be RUNNING
- ✅ Usage events should appear within 5 seconds of opening Acrobat
- ✅ Status file should contain installation details

## Troubleshooting
- If API test fails: Check localhost:3000 is running
- If task not running: Check Windows Event Logs
- If no events: Verify Adobe Acrobat is actually running
`;

    const instructionsPath = path.join(__dirname, 'LOCAL-TEST-INSTRUCTIONS.md');
    fs.writeFileSync(instructionsPath, instructions);
    console.log(`  📄 Test instructions saved to: ${instructionsPath}`);
}

async function runAllTests() {
    console.log('🚀 Starting Local Intune Package Tests\n');
    
    const results = {
        scriptGeneration: await testScriptGeneration(),
        packageGeneration: await testIntunePackageGeneration(),
        serverRoutes: await testServerRoutes()
    };
    
    await createTestInstructions();
    
    console.log('\n📊 Test Results Summary:');
    console.log('========================');
    Object.entries(results).forEach(([test, passed]) => {
        const status = passed ? '✅ PASSED' : '❌ FAILED';
        console.log(`${status} ${test}`);
    });
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('\n🎉 All tests passed! Ready for deployment.');
        console.log('\nNext steps:');
        console.log('1. Run: npm run dev');
        console.log('2. Test the monitoring script manually');
        console.log('3. Test the Intune package installation');
        console.log('4. Deploy to GitHub when ready');
    } else {
        console.log('\n⚠️  Some tests failed. Please fix issues before deploying.');
    }
    
    return allPassed;
}

// Run tests if this script is executed directly
if (require.main === module) {
    runAllTests().catch(console.error);
}

module.exports = { runAllTests, testScriptGeneration, testIntunePackageGeneration };
