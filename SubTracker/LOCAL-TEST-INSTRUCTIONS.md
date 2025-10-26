# Local Testing Instructions

## Prerequisites
1. Make sure your local server is running: `npm run dev`
2. Have Adobe Acrobat installed for testing
3. PowerShell execution policy allows scripts: `Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser`

## Test Steps

### 1. Test Script Generation
- Run this test script: `node test-intune-local.js`
- Check that test-monitoring-script.ps1 was created
- Verify it contains your API key and 5-second intervals

### 2. Test Manual Script Execution
```powershell
# Run the generated test script
PowerShell.exe -ExecutionPolicy Bypass -File test-monitoring-script.ps1
```
- Should show "API connection successful!"
- Should start monitoring with 5-second intervals
- Open Adobe Acrobat and verify events appear in your app

### 3. Test Intune Package
- Extract test-intune-package.zip
- Run Install-AdobeMonitor.ps1 as Administrator
- Check C:\ProgramData\AdobeMonitor\status.json for installation status
- Run troubleshoot-monitoring.ps1 to verify everything is working

### 4. Test Troubleshooting Script
```powershell
PowerShell.exe -ExecutionPolicy Bypass -File troubleshoot-monitoring.ps1
```
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
